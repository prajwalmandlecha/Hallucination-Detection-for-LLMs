import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Trash2, UploadCloud, Database } from "lucide-react";
import { useKnowledgeBase } from "@/hooks/use-knowledge-base";
import { useRef, useState } from "react";

interface KnowledgeBaseModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function KnowledgeBaseModal({ isOpen, onOpenChange }: KnowledgeBaseModalProps) {
  const { documents, uploadFile, removeDocument, isLoading } = useKnowledgeBase();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIsUploading(true);
      setUploadError(null);
      try {
        await uploadFile(file);
      } catch (err) {
        console.error("Failed to upload", err);
        setUploadError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] bg-pane text-foreground border-border-subtle font-sans">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-semibold">
            <Database className="w-5 h-5 text-pri" /> Global Knowledge Base
          </DialogTitle>
          <DialogDescription className="text-sec">
            Manage reference documents used strictly by the verification engine. These documents are not passed to the primary LLM to preserve blind verification.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6 mt-4">
          <div
            className="border-2 border-dashed border-border-subtle rounded-lg p-8 flex flex-col items-center justify-center text-center cursor-pointer hover:border-pri/50 hover:bg-hover transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadCloud className="w-10 h-10 text-mut mb-4" />
            <h3 className="font-medium text-pri">
              {isUploading ? "Uploading..." : "Click to upload document"}
            </h3>
            <p className="text-sm text-sec mt-1">Supports PDF, TXT</p>
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept=".pdf,.txt"
              onChange={handleFileChange}
              disabled={isUploading}
            />
          </div>

          {uploadError && (
            <div className="text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
              {uploadError}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <h4 className="font-semibold text-sec text-sm mb-2 uppercase tracking-wide">
              Ingested Documents ({documents.length})
            </h4>
            
            <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto pr-2">
              {isLoading ? (
                <div className="text-sm text-mut">Loading documents...</div>
              ) : documents.length === 0 ? (
                <div className="text-sm text-mut italic">No documents uploaded yet.</div>
              ) : (
                documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between p-3 rounded-md bg-hover/50 border border-border-subtle"
                  >
                    <div className="flex flex-col overflow-hidden mr-4">
                      <span className="font-medium text-pri truncate" title={doc.filename}>{doc.filename}</span>
                      <span className="text-xs text-mut whitespace-nowrap">
                        {(doc.file_size_bytes / 1024).toFixed(1)} KB • {doc.chunk_count} chunk(s) • {new Date(doc.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeDocument(doc.id)}
                      className="text-red-500 hover:bg-red-500/10 hover:text-red-600 flex-shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}