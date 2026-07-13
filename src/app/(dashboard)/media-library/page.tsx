"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { toast } from "sonner";
import {
  uploadAccountMedia,
  deleteAccountMedia,
  MEDIA_LIBRARY_BUCKET,
  MEDIA_MAX_BYTES_BY_KIND,
} from "@/lib/storage/upload-media";
import type { ApiMediaAsset, ApiMediaTag } from "@/lib/api/v1/media-library";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FolderOpen,
  Plus,
  Upload,
  Trash2,
  Search,
  X,
  Image as ImageIcon,
  Video,
  FileText,
  Loader2,
  Tag,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";

function ContactSearchDialog({
  open,
  onOpenChange,
  onSelect,
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (contactId: string) => void;
  loading: boolean;
}) {
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<{ id: string; name: string; phone: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    if (!open) {
      setQuery("");
      setContacts([]);
      return;
    }
  }, [open]);

  useEffect(() => {
    if (!query.trim()) {
      setContacts([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      const { data } = await supabase
        .from("contacts")
        .select("id, name, phone")
        .or(`name.ilike.%${query}%,phone.ilike.%${query}%`)
        .order("name")
        .limit(20);
      setContacts((data ?? []) as { id: string; name: string; phone: string }[]);
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, supabase]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover text-popover-foreground border-border sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Send to Contact</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search contacts..."
            className="bg-muted border-border"
            autoFocus
          />
          <div className="max-h-48 overflow-y-auto space-y-1">
            {searching ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : contacts.length === 0 && query.trim() ? (
              <p className="text-sm text-muted-foreground text-center py-4">No contacts found</p>
            ) : (
              contacts.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onSelect(c.id)}
                  disabled={loading}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-muted transition-colors"
                >
                  <p className="text-sm font-medium text-foreground">{c.name || "Unnamed"}</p>
                  <p className="text-xs text-muted-foreground">{c.phone}</p>
                </button>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function MediaLibraryPage() {
  const { t } = useLanguage();
  const { accountId } = useAuth();
  const supabase = createClient();

  const [assets, setAssets] = useState<ApiMediaAsset[]>([]);
  const [tags, setTags] = useState<ApiMediaTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [tagFilter, setTagFilter] = useState<string>("");

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [newTagOpen, setNewTagOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#6366f1");

  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [selectedAssetForSend, setSelectedAssetForSend] = useState<ApiMediaAsset | null>(null);
  const [sending, setSending] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadForm, setUploadForm] = useState({
    name: "",
    caption: "",
    tag_ids: [] as string[],
    file: null as File | null,
  });

  const fetchAssets = useCallback(async () => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (typeFilter) params.set("type", typeFilter);
    if (tagFilter) params.set("tag", tagFilter);

    const res = await fetch(`/api/media-library?${params.toString()}`);
    const json = await res.json().catch(() => ({ data: [] }));
    setAssets(json.data ?? []);
    setLoading(false);
  }, [search, typeFilter, tagFilter]);

  const fetchTags = useCallback(async () => {
    const res = await fetch("/api/media-library/tags");
    const json = await res.json().catch(() => ({ data: [] }));
    setTags(json.data ?? []);
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchAssets();
  }, [fetchAssets]);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  async function handleUpload() {
    if (!uploadForm.file || !uploadForm.name.trim()) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", uploadForm.file);
      formData.append("name", uploadForm.name.trim());
      if (uploadForm.caption.trim()) formData.append("caption", uploadForm.caption.trim());
      formData.append("tag_ids", JSON.stringify(uploadForm.tag_ids));

      const res = await fetch("/api/media-library", { method: "POST", body: formData });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Upload failed");
        return;
      }
      toast.success("Media added to library");
      setUploadOpen(false);
      setUploadForm({ name: "", caption: "", tag_ids: [], file: null });
      fetchAssets();
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/media-library/${id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Failed to delete");
        return;
      }
      toast.success("Media deleted");
      fetchAssets();
    } catch {
      toast.error("Failed to delete");
    }
  }

  async function handleCreateTag() {
    if (!newTagName.trim()) return;
    try {
      const res = await fetch("/api/media-library/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTagName.trim(), color: newTagColor }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error ?? "Failed to create tag");
        return;
      }
      toast.success("Tag created");
      setNewTagName("");
      setNewTagOpen(false);
      fetchTags();
    } catch {
      toast.error("Failed to create tag");
    }
  }

  async function handleDeleteTag(id: string) {
    try {
      await fetch(`/api/media-library/tags/${id}`, { method: "DELETE" });
      fetchTags();
      if (tagFilter === id) setTagFilter("");
    } catch {
      toast.error("Failed to delete tag");
    }
  }

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    let kind: "image" | "video" | "document" = "document";
    if (file.type.startsWith("image/")) kind = "image";
    else if (file.type.startsWith("video/")) kind = "video";

    const max = MEDIA_MAX_BYTES_BY_KIND[kind];
    if (file.size > max) {
      toast.error(`File is too large. ${kind} limit is ${Math.round(max / 1024 / 1024)} MB.`);
      return;
    }

    setUploadForm((prev) => ({
      ...prev,
      name: prev.name || file.name.replace(/\.[^.]+$/, ""),
      file,
    }));
    e.target.value = "";
  }

  function toggleUploadTag(tagId: string) {
    setUploadForm((prev) => ({
      ...prev,
      tag_ids: prev.tag_ids.includes(tagId)
        ? prev.tag_ids.filter((id) => id !== tagId)
        : [...prev.tag_ids, tagId],
    }));
  }

  async function handleSendToContact(contactId: string) {
    if (!selectedAssetForSend) return;
    setSending(true);
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact_id: contactId,
          message_type: selectedAssetForSend.media_type,
          media_url: selectedAssetForSend.media_url,
          content_text: selectedAssetForSend.caption || undefined,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error ?? "Failed to send");
        return;
      }
      toast.success("Media sent");
      setContactPickerOpen(false);
      setSelectedAssetForSend(null);
    } catch {
      toast.error("Failed to send");
    } finally {
      setSending(false);
    }
  }

  const typeIcon = (mediaType: string) => {
    switch (mediaType) {
      case "image": return <ImageIcon className="h-4 w-4" />;
      case "video": return <Video className="h-4 w-4" />;
      default: return <FileText className="h-4 w-4" />;
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("nav.mediaLibrary")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Store and reuse images, videos, and documents across conversations.
          </p>
        </div>
        <Button
          onClick={() => setUploadOpen(true)}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Upload className="h-4 w-4 mr-2" />
          Upload
        </Button>
        <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
          <DialogContent className="bg-popover text-popover-foreground border-border sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Upload Media</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 transition-colors",
                  uploadForm.file && "border-primary/50 bg-muted/20"
                )}
              >
                {uploadForm.file ? (
                  <div className="space-y-2">
                    {uploadForm.file.type.startsWith("image/") && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={URL.createObjectURL(uploadForm.file)}
                        alt="Preview"
                        className="max-h-32 mx-auto rounded-lg object-cover"
                      />
                    )}
                    <p className="text-sm text-foreground font-medium">{uploadForm.file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(uploadForm.file.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      Click to select a file or drag & drop
                    </p>
                  </div>
                )}
                <input ref={fileInputRef} type="file" className="hidden" onChange={handleFilePick}
                  accept="image/png,image/jpeg,image/webp,video/mp4,video/3gpp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Name</label>
                <Input
                  value={uploadForm.name}
                  onChange={(e) => setUploadForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Client testimonial - before and after"
                  className="bg-muted border-border"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Caption (sent with the media)</label>
                <Input
                  value={uploadForm.caption}
                  onChange={(e) => setUploadForm((p) => ({ ...p, caption: e.target.value }))}
                  placeholder="e.g. Check out these results!"
                  className="bg-muted border-border"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground">Tags</label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => setNewTagOpen(true)}
                  >
                    <Plus className="h-3 w-3 mr-1" /> New tag
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => {
                    const selected = uploadForm.tag_ids.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        onClick={() => toggleUploadTag(tag.id)}
                        className={cn(
                          "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-all cursor-pointer",
                          selected
                            ? "ring-2 ring-primary ring-offset-1 ring-offset-border"
                            : "opacity-50 hover:opacity-80"
                        )}
                        style={{
                          backgroundColor: (tag.color || "#6366f1") + "20",
                          color: tag.color || "#6366f1",
                        }}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                  {tags.length === 0 && (
                    <p className="text-xs text-muted-foreground">No tags yet. Create one above.</p>
                  )}
                </div>
              </div>

              <Button
                onClick={handleUpload}
                disabled={!uploadForm.file || !uploadForm.name.trim() || uploading}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                Upload to Library
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* New tag mini-dialog */}
      <Dialog open={newTagOpen} onOpenChange={setNewTagOpen}>
        <DialogContent className="bg-popover text-popover-foreground border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New Tag</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Name</label>
              <Input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="e.g. Social Proof"
                className="bg-muted border-border"
                onKeyDown={(e) => { if (e.key === "Enter") handleCreateTag(); }}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Color</label>
              <div className="flex gap-2">
                {["#6366f1", "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#06b6d4"].map((c) => (
                  <button
                    key={c}
                    onClick={() => setNewTagColor(c)}
                    className={cn(
                      "h-7 w-7 rounded-full border-2 transition-all",
                      newTagColor === c ? "border-foreground scale-110" : "border-transparent"
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <Button onClick={handleCreateTag} disabled={!newTagName.trim()} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">
              Create Tag
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search media..."
            className="pl-9 bg-muted border-border"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="bg-muted border border-border text-foreground text-sm rounded-lg px-3 py-2"
        >
          <option value="">All types</option>
          <option value="image">Images</option>
          <option value="video">Videos</option>
          <option value="document">Documents</option>
        </select>

        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <button
              key={tag.id}
              onClick={() => setTagFilter(tagFilter === tag.id ? "" : tag.id)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-all cursor-pointer",
                tagFilter === tag.id ? "ring-2 ring-primary ring-offset-1 ring-offset-border" : "opacity-60 hover:opacity-100"
              )}
              style={{
                backgroundColor: (tag.color || "#6366f1") + "20",
                color: tag.color || "#6366f1",
              }}
            >
              {tag.name}
              <button
                onClick={(e) => { e.stopPropagation(); handleDeleteTag(tag.id); }}
                className="ml-0.5 text-current opacity-50 hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : assets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-foreground">No media yet</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Upload images, videos, or documents to your library.
          </p>
          <Button onClick={() => setUploadOpen(true)} className="mt-4 bg-primary hover:bg-primary/90 text-primary-foreground">
            <Upload className="h-4 w-4 mr-2" /> Upload your first media
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {assets.map((asset) => (
            <div
              key={asset.id}
              className="group rounded-xl border border-border bg-card overflow-hidden hover:border-primary/30 transition-colors"
            >
              <div className="aspect-square bg-muted flex items-center justify-center overflow-hidden">
                {asset.media_type === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={asset.media_url}
                    alt={asset.name}
                    className="h-full w-full object-cover"
                  />
                ) : asset.media_type === "video" ? (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Video className="h-10 w-10" />
                    <span className="text-xs">Video</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <FileText className="h-10 w-10" />
                    <span className="text-xs">Document</span>
                  </div>
                )}
              </div>
              <div className="p-3">
                <p className="text-sm font-medium text-foreground truncate" title={asset.name}>
                  {asset.name}
                </p>
                {asset.caption && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5" title={asset.caption}>
                    {asset.caption}
                  </p>
                )}
                <div className="flex flex-wrap gap-1 mt-2">
                  {asset.tags.map((tag) => (
                    <span
                      key={tag.id}
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                      style={{
                        backgroundColor: (tag.color || "#6366f1") + "20",
                        color: tag.color || "#6366f1",
                      }}
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-1 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs flex-1"
                    onClick={() => {
                      setSelectedAssetForSend(asset);
                      setContactPickerOpen(true);
                    }}
                  >
                    <Send className="h-3 w-3 mr-1" /> Send
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-red-400 hover:text-red-300"
                    onClick={() => handleDelete(asset.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ContactSearchDialog
        open={contactPickerOpen}
        onOpenChange={setContactPickerOpen}
        onSelect={handleSendToContact}
        loading={sending}
      />
    </div>
  );
}
