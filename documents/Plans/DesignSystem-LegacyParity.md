# Hệ thiết kế — bắt kịp diện mạo hệ cũ

> Anh Tuấn: *"trang hiện tại xấu quá, làm giống hệ cũ cho xịn"*.
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
