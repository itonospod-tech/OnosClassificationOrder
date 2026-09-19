import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import axios from 'axios';
import type { Model } from 'mongoose';
import { PDFDocument } from 'pdf-lib';
import type { ExportShippingLabelsRes } from 'shared';

import { buildDriveDownloadUrl, extractDriveId } from '@/utils/design-url';

import type { LabelExportSource, LabelSkipReason } from './label-export';
import { resolveLabelExportSources } from './label-export';
import { OrderEntity } from './order.entity';

/** Khổ trang cho label dạng ẢNH (PNG/JPG) — 4×6 inch theo point (72pt/inch). */
const PAGE_W = 288;
const PAGE_H = 432;
/** Trần tải 1 file label — label thật chỉ vài chục KB–vài MB, quá là bất thường. */
const MAX_LABEL_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
const FETCH_CONCURRENCY = 5;

/**
 * Xuất 1 file PDF gộp label THẬT của carrier (USPS…) cho N đơn đang tick —
 * mỗi label 1 trang (label PDF nhiều trang thì giữ nguyên số trang của nó).
 *
 * Nguồn label KHÔNG vẽ lại: là file đã mua qua VNP (`vnpShipment.labelUrl`,
 * PDF trên CloudFront) hoặc khách tự cấp ORD-26 (`tracking.labelUrl`, thường
 * là link Google Drive → đổi sang direct-download). Ghép bằng pdf-lib thuần
 * JS — không cần headless browser trên VPS. Đơn thiếu label / tải lỗi chỉ
 * hỏng RIÊNG nó, file vẫn ra với phần còn lại (mirror khuôn in tem loạt).
 */
@Injectable()
export class ShippingLabelPdfService {
  constructor(
    @InjectModel(OrderEntity.name)
    private readonly orderModel: Model<OrderEntity>,
  ) {}

  async exportPdf(ids: string[]): Promise<ExportShippingLabelsRes> {
    const docs = await this.orderModel
      .find({ _id: { $in: ids } })
      .select(['productionId', 'vnpShipment.labelUrl', 'vnpShipment.cancelledAt', 'tracking.labelUrl'])
      .lean();

    const { sources, merged, skipped } = resolveLabelExportSources(ids, docs);
    const allSkipped: { productionId: string; reason: LabelSkipReason }[] = [...skipped];

    // Tải song song có trần — rồi GHÉP TUẦN TỰ theo thứ tự tick để thứ tự
    // trang PDF khớp thứ tự bảng người dùng đang nhìn.
    const fetched = new Map<string, Buffer | null>();
    for (let i = 0; i < sources.length; i += FETCH_CONCURRENCY) {
      await Promise.all(
        sources.slice(i, i + FETCH_CONCURRENCY).map(async (s) => {
          fetched.set(s.productionId, await this.fetchLabel(s));
        }),
      );
    }

    const out = await PDFDocument.create();
    let labelCount = 0;
    for (const s of sources) {
      const bytes = fetched.get(s.productionId);
      if (!bytes) {
        allSkipped.push({ productionId: s.productionId, reason: 'fetch-failed' });
        continue;
      }
      const added = await this.appendLabel(out, bytes);
      if (added) labelCount++;
      else allSkipped.push({ productionId: s.productionId, reason: 'unsupported-format' });
    }

    if (labelCount === 0) {
      return { pdfBase64: null, pageCount: 0, labelCount: 0, merged, skipped: allSkipped };
    }
    // `PDFDocument.save()` của pdf-lib (serialize ra bytes) — không phải
    // Mongoose document.save() mà rule cấm.
    // eslint-disable-next-line no-restricted-properties
    const pdfBytes = await out.save();
    return {
      pdfBase64: Buffer.from(pdfBytes).toString('base64'),
      pageCount: out.getPageCount(),
      labelCount,
      merged,
      skipped: allSkipped,
    };
  }

  /** Tải 1 file label — Drive link đổi sang direct-download; lỗi trả null (không ném). */
  private async fetchLabel(source: LabelExportSource): Promise<Buffer | null> {
    const driveId = extractDriveId(source.labelUrl);
    const url = driveId ? buildDriveDownloadUrl(driveId) : source.labelUrl;
    try {
      const res = await axios.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        timeout: FETCH_TIMEOUT_MS,
        maxContentLength: MAX_LABEL_BYTES,
        // Drive direct-download redirect qua googleusercontent — phải theo.
        maxRedirects: 5,
      });
      const buf = Buffer.from(res.data);
      // Drive file không public / quá to → trả trang HTML thay vì file.
      if (buf.subarray(0, 15).toString('utf8').trimStart().startsWith('<')) return null;
      return buf;
    } catch (err) {
      console.warn(
        `[label-pdf] fetch failed ${source.productionId} (${source.provider}): ${(err as Error).message}`,
      );
      return null;
    }
  }

  /** Nhét 1 label vào PDF gộp: PDF → copy nguyên trang; PNG/JPG → trang 4×6in fit ảnh. */
  private async appendLabel(out: PDFDocument, bytes: Buffer): Promise<boolean> {
    try {
      if (bytes.subarray(0, 5).toString('utf8') === '%PDF-') {
        const src = await PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: true });
        const pages = await out.copyPages(src, src.getPageIndices());
        for (const p of pages) out.addPage(p);
        return true;
      }
      const isPng = bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
      if (!isPng && !isJpg) return false;
      const img = isPng ? await out.embedPng(new Uint8Array(bytes)) : await out.embedJpg(new Uint8Array(bytes));
      const page = out.addPage([PAGE_W, PAGE_H]);
      const scale = Math.min(PAGE_W / img.width, PAGE_H / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: (PAGE_W - w) / 2, y: (PAGE_H - h) / 2, width: w, height: h });
      return true;
    } catch (err) {
      console.warn(`[label-pdf] append failed: ${(err as Error).message}`);
      return false;
    }
  }
}
