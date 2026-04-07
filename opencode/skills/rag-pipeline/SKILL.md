---
name: rag-pipeline
description: "RAG system design — document loading, chunking, embeddings, vector stores, retrieval, generation"
---

# RAG Pipeline Skill

## When to Use

When building Retrieval-Augmented Generation systems — document Q&A, knowledge bases, semantic search, or any LLM application that needs external knowledge grounding.

## RAG Architecture

```
Documents → Loader → Chunker → Embedder → Vector Store
                                               ↓
User Query → Embedder → Retriever → Reranker → Context + Query → LLM → Answer
```

## Document Loading

```python
# LangChain loaders
from langchain_community.document_loaders import (
    PyPDFLoader,
    TextLoader,
    CSVLoader,
    UnstructuredMarkdownLoader,
    DirectoryLoader,
    WebBaseLoader,
)

# Single file
loader = PyPDFLoader("document.pdf")
docs = loader.load()

# Directory
loader = DirectoryLoader(
    "docs/",
    glob="**/*.md",
    loader_cls=UnstructuredMarkdownLoader,
    show_progress=True,
)
docs = loader.load()

# Web pages
loader = WebBaseLoader(["https://docs.example.com/page1", "https://docs.example.com/page2"])
docs = loader.load()
```

## Chunking Strategies

```python
from langchain.text_splitter import (
    RecursiveCharacterTextSplitter,
    MarkdownHeaderTextSplitter,
    TokenTextSplitter,
)

# Recursive (best default)
splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,           # Characters per chunk
    chunk_overlap=200,          # Overlap between chunks
    separators=["\n\n", "\n", ". ", " ", ""],
    length_function=len,
)
chunks = splitter.split_documents(docs)

# Markdown-aware
md_splitter = MarkdownHeaderTextSplitter(
    headers_to_split_on=[
        ("#", "Header 1"),
        ("##", "Header 2"),
        ("###", "Header 3"),
    ]
)
chunks = md_splitter.split_text(markdown_text)

# Token-based (for precise token control)
splitter = TokenTextSplitter(
    chunk_size=500,             # Tokens
    chunk_overlap=50,
    encoding_name="cl100k_base",
)
```

### Chunk Size Guidelines

| Content Type | Chunk Size | Overlap | Rationale |
|-------------|-----------|---------|-----------|
| Technical docs | 1000-1500 | 200 | Functions/sections need context |
| FAQs | 300-500 | 50 | Each Q&A is self-contained |
| Legal/contracts | 1500-2000 | 300 | Clauses need surrounding context |
| Code | 500-1000 | 100 | Function-level chunks |
| Chat logs | 500-800 | 100 | Conversation turns |

## Embeddings

```python
# OpenAI
from langchain_openai import OpenAIEmbeddings
embeddings = OpenAIEmbeddings(model="text-embedding-3-small")

# Local (sentence-transformers)
from langchain_huggingface import HuggingFaceEmbeddings
embeddings = HuggingFaceEmbeddings(
    model_name="BAAI/bge-small-en-v1.5",
    model_kwargs={"device": "cuda"},
    encode_kwargs={"normalize_embeddings": True},
)

# Multilingual
embeddings = HuggingFaceEmbeddings(
    model_name="intfloat/multilingual-e5-large",
)
```

## Vector Stores

### FAISS (Local, fast)

```python
from langchain_community.vectorstores import FAISS

# Create
vectorstore = FAISS.from_documents(chunks, embeddings)

# Save/Load
vectorstore.save_local("faiss_index")
vectorstore = FAISS.load_local("faiss_index", embeddings, allow_dangerous_deserialization=True)

# Search
results = vectorstore.similarity_search("query", k=5)
results_with_scores = vectorstore.similarity_search_with_score("query", k=5)
```

### Chroma (Local, persistent)

```python
from langchain_community.vectorstores import Chroma

vectorstore = Chroma.from_documents(
    chunks,
    embeddings,
    persist_directory="chroma_db",
    collection_metadata={"hnsw:space": "cosine"},
)

# With metadata filtering
results = vectorstore.similarity_search(
    "query",
    k=5,
    filter={"source": "manual.pdf"},
)
```

### Milvus (Distributed, production)

```python
from langchain_community.vectorstores import Milvus

vectorstore = Milvus.from_documents(
    chunks,
    embeddings,
    connection_args={"host": "localhost", "port": 19530},
    collection_name="documents",
)
```

## Retrieval

```python
# Basic retriever
retriever = vectorstore.as_retriever(
    search_type="similarity",       # "similarity", "mmr", "similarity_score_threshold"
    search_kwargs={"k": 5},
)

# MMR (Maximum Marginal Relevance) — diversity
retriever = vectorstore.as_retriever(
    search_type="mmr",
    search_kwargs={"k": 5, "fetch_k": 20, "lambda_mult": 0.7},
)

# With score threshold
retriever = vectorstore.as_retriever(
    search_type="similarity_score_threshold",
    search_kwargs={"score_threshold": 0.7, "k": 10},
)

# Retrieve
docs = retriever.invoke("How does the detection pipeline work?")
```

### Hybrid Search (BM25 + Vector)

```python
from langchain.retrievers import EnsembleRetriever
from langchain_community.retrievers import BM25Retriever

bm25_retriever = BM25Retriever.from_documents(chunks, k=5)
vector_retriever = vectorstore.as_retriever(search_kwargs={"k": 5})

ensemble_retriever = EnsembleRetriever(
    retrievers=[bm25_retriever, vector_retriever],
    weights=[0.4, 0.6],
)
```

## Generation (RAG Chain)

```python
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

template = """Answer the question based only on the following context.
If the context doesn't contain the answer, say "I don't know."

Context:
{context}

Question: {question}

Answer:"""

prompt = ChatPromptTemplate.from_template(template)

def format_docs(docs):
    return "\n\n".join(doc.page_content for doc in docs)

rag_chain = (
    {"context": retriever | format_docs, "question": RunnablePassthrough()}
    | prompt
    | llm
    | StrOutputParser()
)

answer = rag_chain.invoke("What is the detection confidence threshold?")
```

## Evaluation

```python
# Retrieval metrics
def evaluate_retrieval(queries, ground_truth, retriever, k=5):
    metrics = {"recall": [], "mrr": []}

    for query, relevant_ids in zip(queries, ground_truth):
        retrieved = retriever.invoke(query)
        retrieved_ids = [doc.metadata["id"] for doc in retrieved[:k]]

        # Recall@k
        hits = len(set(retrieved_ids) & set(relevant_ids))
        metrics["recall"].append(hits / len(relevant_ids))

        # MRR
        for i, rid in enumerate(retrieved_ids):
            if rid in relevant_ids:
                metrics["mrr"].append(1 / (i + 1))
                break
        else:
            metrics["mrr"].append(0)

    return {k: sum(v) / len(v) for k, v in metrics.items()}
```

## Best Practices

1. **Chunk overlap** — always use 10-20% overlap to avoid splitting context
2. **Metadata** — store source file, page number, section headers in chunk metadata
3. **Hybrid search** — combine BM25 + vector for best recall
4. **MMR retrieval** — use for diverse results, avoid redundant chunks
5. **Reranking** — use cross-encoder reranker for top-k precision (Cohere, BGE)
6. **Context window budget** — fit retrieved context within model's limit
7. **Evaluation** — measure retrieval recall and answer quality separately
8. **Incremental updates** — add/remove documents without full re-index
