import { useState, useEffect } from "react";
import { uploadDocument as apiUploadDocument, deleteDocument as apiDeleteDocument, getGlobalDocuments as apiGetGlobalDocuments } from "@/lib/api";
import type { DocumentResponse } from "@/lib/api";

export function useKnowledgeBase() {
  const [documents, setDocuments] = useState<DocumentResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load from backend on mount
  useEffect(() => {
    let mounted = true;
    const fetchDocs = async () => {
      try {
        const docs = await apiGetGlobalDocuments();
        if (mounted) setDocuments(docs);
      } catch (err) {
        console.error("Failed to fetch knowledge base from backend", err);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };
    fetchDocs();
    return () => { mounted = false; };
  }, []);

  const uploadFile = async (file: File, conversationId?: string) => {
    try {
      // 1. Upload to backend
      const res = await apiUploadDocument(file, conversationId);

      // 2. Add to local knowledge base if no conversationId (meaning it's global)
      if (!conversationId) {
        setDocuments(prev => {
          const next = [res, ...prev];
          return next;
        });
      }
      return res;
    } catch (err) {
      console.error("Upload failed", err);
      throw err;
    }
  };

  const removeDocument = async (docId: string) => {
    try {
      // 1. Delete from backend to save space in VectorDB
      await apiDeleteDocument(docId);
    } catch (err) {
      console.warn("Backend delete document warning", err);
    }
    setDocuments(prev => prev.filter(d => d.id !== docId));
  };

  return {
    documents,
    isLoading,
    uploadFile,
    removeDocument
  };
}
