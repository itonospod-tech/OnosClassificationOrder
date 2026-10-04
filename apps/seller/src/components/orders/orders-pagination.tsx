"use client";

/**
 * Shared pagination footer cho Orders list — Hub + Portal cùng dùng
 * (THG-SELLER-005 full visual sync).
 *
 * Layout: trái = "Showing X–Y of N" + Rows: [10/20/50/100] dropdown (legacy parity). Phải =
 * chevron prev + numbered page buttons (max 5) + chevron next.
 *
 * Trước đây Hub có inline pagination bên trong table card (line 814-868
 * cũ), Portal có pagination ngoài + limit dropdown riêng — visual khác.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";

interface OrdersPaginationProps {
  page: number;
  limit: number;
  pages: number;
  total: number;
  onChange: (next: { page?: number; limit?: number }) => void;
}

export function OrdersPagination({ page, limit, pages, total, onChange }: OrdersPaginationProps) {
  if (total === 0) return null;

  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-t border-border2 text-[10px] text-text-muted">
      <div className="flex items-center gap-3">
        <span>
          Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
        </span>
        <label className="flex items-center gap-1.5">
          <span>Rows:</span>
          <select
            value={limit}
            onChange={(e) => onChange({ limit: Number(e.target.value), page: 1 })}
            className="px-1.5 py-0.5 rounded border border-border1 bg-card text-[10px] cursor-pointer"
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>
      </div>
      {total > limit && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => onChange({ page: Math.max(1, page - 1) })}
            disabled={page === 1}
            className="px-2 py-1 rounded border border-border1 bg-card disabled:opacity-50 cursor-pointer hover:bg-card-hover"
            aria-label="Previous page"
          >
            <ChevronLeft size={12} />
          </button>
          {Array.from({ length: Math.min(5, pages) }, (_, i) => (
            <button
              key={i + 1}
              onClick={() => onChange({ page: i + 1 })}
              className={`px-2 py-1 rounded cursor-pointer ${
                page === i + 1
                  ? "bg-cta text-cta-foreground border-none"
                  : "border border-border1 bg-card hover:bg-card-hover"
              }`}
            >
              {i + 1}
            </button>
          ))}
          <button
            onClick={() => onChange({ page: Math.min(pages, page + 1) })}
            disabled={page === pages}
            className="px-2 py-1 rounded border border-border1 bg-card disabled:opacity-50 cursor-pointer hover:bg-card-hover"
            aria-label="Next page"
          >
            <ChevronRight size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
