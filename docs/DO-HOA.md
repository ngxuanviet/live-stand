# Tuỳ chỉnh đồ họa

Toàn bộ đồ họa overlay được **vẽ bằng code** trong [`overlay/js/art.js`](../overlay/js/art.js) (không dùng ảnh có sẵn). Cảnh được vẽ trên một canvas "logic" độ phân giải thấp (270×480 cho màn dọc, 480×270 cho màn ngang) rồi phóng nguyên lên kích thước thật nên giữ được nét pixel-art.

Sau khi sửa code, tải lại overlay là thấy ngay (không cần build). Cách xem thử nhanh: mở tab **Test Panel** trong Dashboard, bấm "Tạo nhanh nhiều người xem" và xem khung **Xem trước** bên phải. (File `design/mockup.html` có bản sao riêng của mã vẽ, chỉ là tài liệu thiết kế ban đầu và **không** tự cập nhật theo `art.js`.)

## Nhân vật

Mỗi nhân vật gồm **đầu 26×26** (tóc/mũ pixel-art + avatar người xem làm khuôn mặt, vẽ ở độ phân giải thật nên nét) và **thân 16×14** mặc áo bóng đá. Mọi đặc điểm được chọn theo `hash` của `userKey` nên một người luôn có cùng hình dáng.

| Muốn đổi | Sửa ở | Ghi chú |
|---|---|---|
| Màu áo (áo chính + màu viền) | mảng `JERSEY` | Mỗi phần tử `{ m: 'màu áo', t: 'màu viền' }` |
| Màu quần | mảng `PANTS` | |
| Tông da tay | mảng `SKINS` (chỉ 4 phần tử đầu dùng cho tay) | |
| Màu tóc | mảng `HAIRS` | |
| Kiểu tóc/mũ (6 kiểu) | hàm `buildHead`, các nhánh `if (style === …)` | Mỗi kiểu là vài lệnh `R(c, x, y, w, h, màu)` vẽ các khối chữ nhật trên canvas 26×26 |
| Dáng thân, tay, chân, hoạt ảnh | hàm `drawChar` | Trạng thái: `idle`, `walk`, `sit`, `jump`, `look` (ngước lên) |
| Ghế VIP (màu, kích thước) | mảng `SEAT` và `RANKCOL` | 5 phần tử, đúng thứ tự hạng 1 → 5 |
| Vương miện, hào quang hạng 1 | `CROWN`, `drawCrown`, `drawAura` | |
| Sân cỏ, thảm đỏ, cột đèn, đồ vật | `buildBackground` | Phần phía trên viền LED (`stageTop`) phải luôn **trong suốt** để đầu VIP chồng lên màn chiếu |
| Dây đèn nhấp nháy | `drawLights` | |
| Hiệu ứng spawn, chớp sáng, lấp lánh | `drawEffect` | |

`R(c, x, y, w, h, màu)` là hàm vẽ một khối chữ nhật; hầu hết đồ họa chỉ dùng hàm này.

### Khi thay đổi số lượng phần tử

Một số chỗ đếm cố định số phần tử. Thêm hoặc bớt phần tử trong mảng thì phải sửa các số này cho khớp:

| Dòng (trong `art.js`) | Đang là | Ý nghĩa |
|---|---|---|
| `charLook`: `h % 8`, `(h >> 3) % 5`, `(h >> 5) % 4` | 8 áo, 5 quần, 4 tông da | Số phần tử của `JERSEY`, `PANTS`, `SKINS` (tay) |
| `plainFace`: `r() * 5` | 5 | Số phần tử của `SKINS` |
| `buildHead`: `r() * 7`, `r() * 6`, `r() * 8` | 7 màu tóc, 6 kiểu, 8 áo | `HAIRS`, số kiểu tóc/mũ, `JERSEY` |

Đổi các số này sẽ làm **ngoại hình của người đã có thay đổi** (vì kết quả `hash % số` đổi); không ảnh hưởng dữ liệu điểm hay tim.

### Ví dụ: thêm một màu áo

Trong `JERSEY`, thêm một dòng:

```js
{ m: '#00b4d8', t: '#ffffff' },   // áo xanh ngọc, viền trắng
```

rồi đổi `h % 8` thành `h % 9` trong `charLook` và `r() * 8` thành `r() * 9` trong `buildHead`.

## Avatar người xem

Avatar được tải qua proxy của server (cùng origin, có cache ở `data/avatars`), cắt tròn và thêm viền tối mảnh (`processFaceHi`). Ảnh **không** bị pixel hoá hay giảm màu: nó được vẽ ở độ phân giải thật của canvas (80×80 điểm ảnh với Stage rộng 1080), còn tóc, mũ và thân vẫn là pixel-art. Chưa tải được ảnh thì dùng mặt giả vẽ bằng code (`plainFace`) và tự đổi sang ảnh thật khi xong. Host ảnh nằm trong danh sách cho phép (`server/http/avatarProxy.js`, thêm qua biến `AVATAR_HOSTS`).

## Bố cục

Vị trí các vùng tính trong `computeLayout` (`overlay/js/scene.js`): viền trên của sân (`stageTop`, ngay sát mép trên, không lề), hàng ghế VIP ngồi cao để đầu nhô lên trên viền, sân chơi chiếm phần còn lại, và vùng chừa trống ở đáy (Safe Zone trong Dashboard, mặc định 0).
