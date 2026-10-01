# Hệ thiết kế — tham chiếu hệ cũ, nhưng làm mới

> Anh Tuấn: *"trang hiện tại xấu quá"* → *"tham khảo hệ cũ nhưng nâng cấp cho
> đẹp, hệ cũ hơn 10 năm rồi; và thiết kế trên điện thoại phải đẹp như native
> iPhone"*.
>
> **Hệ cũ là tham chiếu về CẤU TRÚC và SỰ QUEN TAY, không phải chuẩn thẩm mỹ.**
> Nó dựng trên template Vuexy — bảng màu và hình khối của khoảng 2018.
> Mọi giá trị dưới đây **trích bằng `getComputedStyle` từ `app.onospod.com`**
> ngày 01/10/2026, không phải ước lượng bằng mắt.
>
> Hệ cũ dựng trên template **Vuexy**. Bảng màu dưới là bảng chuẩn của nó.

## 1. Bảng màu

| Vai trò | Mã | Dùng ở |
|---|---|---|
| Chính (primary) | `#7367F0` | mục menu đang chọn, liên kết, nút chính |
| Thành công | `#28C76F` | nhãn hoàn thành, số dương |
| Cảnh báo | `#FF9F43` | nhãn đang xử lý, chờ |
| Nguy hiểm | `#EA5455` | nhãn lỗi/hủy, số âm |
| Tối | `#1E1E1E` | nhãn trung tính đậm |
| Nền trang | `#F8F8F8` | nền ngoài thẻ |
| Chữ thân | `#626262` | chữ mặc định |
| Chữ phụ | `#999999` | tiêu đề nhóm, chú thích |

## 2. Chữ

```
font-family : Montserrat   (hệ mới đang Inter — xem §6)
chữ thân    : #626262
tiêu đề nhóm: #999999 · 12.6px · 500 · letter-spacing .14px · VIẾT HOA
tiêu đề bảng: #626262 · 11.9px · 700
ô bảng      : #626262 · 11.2px
nhãn pill   : trắng · ~9px · 400
```

## 3. Thẻ (card) — hình khối chính của mọi trang

```
nền          #FFFFFF
bo góc       4.2px
đổ bóng      0 4px 25px 0 rgba(0,0,0,.1)
viền         KHÔNG CÓ
```
Đây là khác biệt lớn nhất so với hệ mới: hệ cũ **không dùng viền**, chỉ dùng
**bóng mềm lan rộng** trên nền xám nhạt. Hệ mới đang dùng viền + nền trắng, nên
nhìn phẳng và khô.

## 4. Thành phần

**Bảng**
```
tiêu đề : nền trong suốt · 700 · border-bottom 2px #F8F8F8
ô       : padding 14px 7px · KHÔNG có đường kẻ giữa các dòng
```
Bảng hệ cũ **không kẻ ngang từng dòng** — chỉ một đường dày dưới tiêu đề.

**Ô nhập**
```
nền #FFF · viền 1px rgba(0,0,0,.2) · bo 5px · padding 9.8px
```

**Nhãn / pill**
```
bo góc 140px (viên thuốc tròn hẳn) · chữ trắng · ~9px
nền lấy theo bảng màu §1 tuỳ nghĩa
```

**Sidebar**
```
nền #FFFFFF · bóng phải 0 0 15px rgba(0,0,0,.05) · KHÔNG viền
mục đang chọn: linear-gradient(118deg, #7367F0, rgba(115,103,240,.7))
               + box-shadow 0 0 10px 1px rgba(115,103,240,.7)
               + chữ trắng + bo 4px
mục cha đang mở: nền xám rất nhạt, chữ KHÔNG tím
```

## 5. Bố cục màn hình danh sách (khuôn lặp lại khắp hệ cũ)

```
┌ Tiêu đề trang + breadcrumb ──────── nút hành động tròn, nhiều màu ┐
├ THẺ: hàng nút khoảng ngày (Today · Yesterday · Last 7 Days · …)   │
│      + ô tìm kiếm bên phải                                        │
├ THẺ: tab trạng thái kèm SỐ ĐẾM trên pill                          │
│      hàng lọc (số dòng/trang · các select)                        │
│      bảng                                                          │
│      phân trang First · 1..n · Last                               │
└───────────────────────────────────────────────────────────────────┘
```

## 6. Ba chỗ KHÔNG bê nguyên — và lý do

**Cỡ chữ.** Hệ cũ dùng 11.2px cho chữ thân. Nhỏ, và nhãn tiếng Việt dài hơn
tiếng Anh. Giữ cỡ chữ hiện tại của hệ mới; lấy **bảng màu và hình khối**, không
lấy số đo.

**Font.** Hệ cũ Montserrat, hệ mới Inter. Đổi font là đổi toàn app, ảnh hưởng cả
trang landing và Seller Portal. Để riêng, quyết sau.

**Chế độ tối.** Hệ cũ không có. Mọi token phải có bản `.dark`: gradient giảm
alpha, quầng sáng giảm, bóng đổ thay bằng viền (bóng đen trên nền tối vô hình).

## 7. Cách làm

Tất cả qua **token Tailwind + biến CSS**, không viết mã màu thẳng vào class.
Đổi màu phải sửa đúng một chỗ. Khuôn đã có sẵn: `brand.*` / `ink.*` của trang
landing trong `tailwind.config.js`.

## 8. Tương phản — chỗ phải kiểm bằng mắt

Chữ trắng trên `#7367F0` đạt ~4.2:1, chuẩn AA cho chữ thường cần 4.5:1. Hệ cũ
cũng vậy. Khi áp, kiểm trên màn hình thật; nếu nhạt thì giữ đuôi gradient đậm
hơn thay vì đổi màu chính.


## 9. Lấy gì của hệ cũ, bỏ gì

**LẤY** — những thứ giúp người đang dùng không phải học lại:
- Cấu trúc màn hình danh sách (§5): thẻ lọc trên, tab trạng thái có số, bảng dưới.
- **Ý nghĩa** màu: tím = đang chọn, xanh = xong, cam = đang chạy, đỏ = lỗi.
- Mỗi link menu mang bộ lọc mặc định có nghĩa (§8.1 của `MenuRestructure-CEO.md`).
- Thẻ nổi trên nền xám nhạt thay vì viền trên nền trắng.

**BỎ** — dấu vết của template 2018:
- Bảng màu bão hoà cao (`#7367F0` tím chói, `#EA5455` đỏ cam). Giữ **vai trò**,
  hạ độ bão hoà và chỉnh cho đạt tương phản AA.
- Gradient + quầng sáng quanh mục đang chọn. Năm 2018 là hiện đại; giờ là cũ.
  Thay bằng nền đặc + chỉ báo mảnh.
- Bo góc 4.2px — cứng. Thang hiện đại: 8/12/16.
- Cỡ chữ 11.2px — quá nhỏ, và nhãn tiếng Việt dài hơn tiếng Anh.
- Font Montserrat. Inter đang dùng tốt hơn cho giao diện dày đặc dữ liệu.

## 10. Điện thoại — phần quan trọng nhất, hiện gần như chưa làm

**Ai dùng:** 26/53 tài khoản là công nhân Fulfillment, 15 là Designer. Họ đứng
tại trạm, cầm điện thoại hoặc máy quét, **không ngồi trước màn hình rộng**. Tức
đa số người dùng thật của hệ thống là người dùng điện thoại.

**Hiện trạng:** `MainLayout` chỉ có `p-4 md:p-6`. Không có ngăn kéo cho sidebar,
không có thanh điều hướng dưới, bảng ngang tràn màn hình. Component `sheet.tsx`
đã có sẵn nhưng sidebar chưa dùng.

**Chuẩn nhắm tới — iOS:**
- **Vùng chạm tối thiểu 44×44pt.** Nút nhỏ hơn là ngón tay trượt.
- **Tầm với một tay:** việc chính nằm **nửa dưới** màn hình. Thanh điều hướng
  dưới, không phải menu trên cùng.
- **Vùng an toàn:** `env(safe-area-inset-bottom)` cho máy có thanh home.
- **Sheet kéo từ dưới** thay cho hộp thoại giữa màn hình.
- **Bảng không cuộn ngang.** Trên điện thoại mỗi dòng thành một **thẻ**, hiện
  3–4 trường quan trọng nhất, chạm để mở chi tiết.
- **Chuyển cảnh có hướng:** đẩy sang trái khi vào sâu, phải khi quay lại.
- **Chiều sâu bằng lớp và mờ nền**, không bằng viền.

**Ba màn hình phải đẹp trên điện thoại trước tiên** — đúng thứ công nhân mở:
1. `/orders/scan-error` — trạm quét mã
2. `/ffm/fulfillment/my-tasks` — bảng việc của công nhân
3. `/ffm/my-tasks` — bảng việc của designer

Ba cái này quan trọng hơn Dashboard, vì Dashboard là của quản lý và quản lý
ngồi máy tính.
