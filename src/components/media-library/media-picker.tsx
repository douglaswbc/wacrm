"use client";

import { useState, useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Search, X, Image as ImageIcon, Video, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ApiMediaAsset, ApiMediaTag } from "@/lib/api/v1/media-library";

export interface MediaPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (asset: Pick<ApiMediaAsset, "media_url" | "media_type" | "caption" | "name">) => void;
}

export function MediaPicker({ open, onOpenChange, onSelect }: MediaPickerProps) {
  const supabase = createClient();
  const [assets, setAssets] = useState<ApiMediaAsset[]>([]);
  const [tags, setTags] = useState<ApiMediaTag[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");

  useEffect(() => {
    if (!open) {
      setSearch("");
      setTagFilter("");
      return;
    }
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (search) params.set("search", search);
        if (tagFilter) params.set("tag", tagFilter);

        const [assetsRes, tagsRes] = await Promise.all([
          fetch(`/api/media-library?${params.toString()}`).then((r) => r.json()).catch(() => ({ data: [] })),
          fetch("/api/media-library/tags").then((r) => r.json()).catch(() => ({ data: [] })),
        ]);
        setAssets(assetsRes.data ?? []);
        setTags(tagsRes.data ?? []);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [open, search, tagFilter]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover text-popover-foreground border-border sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Media Library</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[150px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="pl-9 bg-muted border-border h-9"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setTagFilter("")}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-medium transition-all cursor-pointer",
                !tagFilter ? "bg-primary/20 text-primary ring-1 ring-primary/40" : "bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              All
            </button>
            {tags.map((tag) => (
              <button
                key={tag.id}
                onClick={() => setTagFilter(tagFilter === tag.id ? "" : tag.id)}
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs font-medium transition-all cursor-pointer",
                  tagFilter === tag.id
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
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto mt-3 min-h-[200px]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : assets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">
                {search || tagFilter
                  ? "No media match your filters."
                  : "No media in library yet. Upload from the Media Library page."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {assets.map((asset) => (
                <button
                  key={asset.id}
                  onClick={() => {
                    onSelect({
                      media_url: asset.media_url,
                      media_type: asset.media_type,
                      caption: asset.caption,
                      name: asset.name,
                    });
                    onOpenChange(false);
                  }}
                  className="group rounded-xl border border-border bg-card overflow-hidden hover:border-primary/50 transition-all text-left cursor-pointer"
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
                      <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
                        <Video className="h-8 w-8" />
                        <span className="text-[10px]">Video</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
                        <FileText className="h-8 w-8" />
                        <span className="text-[10px]">Document</span>
                      </div>
                    )}
                  </div>
                  <div className="p-2.5">
                    <p className="text-xs font-medium text-foreground truncate">{asset.name}</p>
                    {asset.caption && (
                      <p className="text-[10px] text-muted-foreground truncate mt-0.5">{asset.caption}</p>
                    )}
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {asset.tags.slice(0, 2).map((tag) => (
                        <span
                          key={tag.id}
                          className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium"
                          style={{
                            backgroundColor: (tag.color || "#6366f1") + "20",
                            color: tag.color || "#6366f1",
                          }}
                        >
                          {tag.name}
                        </span>
                      ))}
                      {asset.tags.length > 2 && (
                        <span className="text-[9px] text-muted-foreground">+{asset.tags.length - 2}</span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
