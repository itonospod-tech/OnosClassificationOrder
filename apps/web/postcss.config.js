import autoprefixer from 'autoprefixer';
import tailwindcss from 'tailwindcss';

/**
 * Gỡ vỏ `@layer` khỏi `theme.css` của `@zero-126/zalo-ui` TRƯỚC khi Tailwind chạy.
 *
 * Từ bản 1.47.1 tệp đó bọc phần màu chữ trong `@layer base { … }` theo kiểu
 * Tailwind v4, nơi `@layer` là tầng của chính Tailwind. App này chạy Tailwind
 * v3, và Vite đưa TỪNG tệp CSS qua postcss riêng lẻ — tệp của nhà cung cấp
 * không có `@tailwind base` đi kèm nên Tailwind v3 dừng build với
 * "`@layer base` is used but no matching `@tailwind base` directive is present".
 *
 * Gỡ vỏ chứ không bỏ nội dung: các khai báo bên trong đi thẳng ra CSS, đúng
 * điều nhà cung cấp muốn (đặt màu chữ cho `.zalo-ui`). Chỉ đụng đúng tệp đó,
 * nhận diện theo đường dẫn, nên CSS của app không đổi hành vi.
 *
 * KHÔNG sửa tệp trong `node_modules` — lần cài sau là mất. Khi nhà cung cấp
 * phát hành bản không còn `@layer`, xoá plugin này đi là xong.
 */
const goVoLayerZalo = {
  postcssPlugin: 'go-vo-layer-zalo-ui',
  Once(root, { result }) {
    if (!String(result.opts.from ?? '').includes('@zero-126/zalo-ui/theme.css')) return;
    root.walkAtRules('layer', (rule) => {
      if (rule.nodes) rule.replaceWith(rule.nodes);
    });
  },
};

export default {
  plugins: [goVoLayerZalo, tailwindcss(), autoprefixer()],
};
