"use client";

interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  /**
   * "hero" = dải nền navy chuyển sắc như khu tiêu đề trên thgfulfill.com.
   * CỐ Ý mặc định "plain": Hub có 71 trang, phần lớn là bảng số liệu dày đặc — nhét dải tối
   * lên đầu MỌI trang thì tốn chiều cao và đẩy bảng xuống dưới nếp gấp. Chỉ bật ở trang tổng
   * quan / trang đầu mục, nơi tiêu đề thật sự là điểm nhìn đầu tiên.
   */
  tone?: "plain" | "hero";
  /** Khu danh sách cần nhiều chỗ cho bảng: bớt margin dưới. */
  compact?: boolean;
}

export function PageHeader({ title, subtitle, actions, children, tone = "plain", compact = false }: PageHeaderProps) {
  if (tone === "hero") {
    return (
      <div
        className="mb-4 rounded-xl px-5 py-4 flex justify-between items-center gap-4"
        style={{
          // Cùng hướng chuyển sắc với hero landing: navy đậm → navy nhạt hơn (#2b3242 là màu
          // đo được từ nền hero của họ).
          background: "linear-gradient(135deg, var(--color-navy) 0%, #2b3242 100%)",
        }}
      >
        <div className="min-w-0">
          <h1 className="text-lg font-extrabold m-0 text-white">{title}</h1>
          {subtitle && (
            // Trắng mờ chứ không xám: xám trên navy chỉ được ~3:1, đọc rất mệt.
            <p className="text-[10.5px] mt-0.5 text-white/70">{subtitle}</p>
          )}
        </div>
        <div className="flex gap-1.5 items-center shrink-0">
          {actions}
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center ${compact ? "mb-1" : "mb-4"}`}>
      <div className="min-w-0">
        <h1 className="text-lg font-extrabold m-0 font-display text-text-primary">{title}</h1>
        {subtitle && <p className={`text-[10.5px] text-text-secondary mt-0.5 ${compact ? "max-md:hidden" : ""}`}>{subtitle}</p>}
      </div>
      {(actions || children) && (
        <div className="flex flex-wrap gap-1.5 items-center sm:shrink-0">
          {actions}
          {children}
        </div>
      )}
    </div>
  );
}
