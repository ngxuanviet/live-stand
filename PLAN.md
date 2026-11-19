# Kế hoạch thực hiện (dựa trên PRD v2)

Thứ tự: **đồ họa trước** (khoá kích thước, hoạt ảnh, layout), rồi code. Mỗi bước có sản phẩm kiểm tra được.

---

## Bước 1 — Thiết kế đồ họa Overlay  ✅ (đã duyệt, mockup: `design/mockup.html`)

> Quyết định đã chốt: chibi, chủ đề fan zone ban đêm trước màn hình khổng lồ; asset sinh bằng code; đầu 26×26 gồm tóc/mũ + avatar 20×20 làm mặt; thỉnh thoảng nhân vật ngước lên xem màn hình. Chi tiết xem PRD_v2 mục 5. Việc còn lại của bước này: tách code vẽ trong mockup thành module dùng chung cho Overlay, giãn sân khi 30 nhân vật.


### 1.1 Chốt thông số kỹ thuật (làm đầu tiên, ảnh hưởng mọi thứ sau)
| Hạng mục | Đề xuất |
|---|---|
| Canvas logic | **270×480** (9:16), scale nguyên ×4 lên 1080×1920; `image-rendering: pixelated` |
| Ngang 16:9 | 480×270 logic, scale ×4 lên 1920×1080; dùng chung đồ họa, chỉ đổi bố cục |
| Thân nhân vật | **24×32 px** (không gồm đầu) |
| Đầu (avatar) | Cắt tròn, hạ về **16×16**, giảm màu (posterize) để hợp pixel-art |
| Bảng màu | 16–24 màu cố định, xác định ở bước này |
| Font | 1 pixel font miễn phí giấy phép thương mại (ví dụ Press Start 2P / Pixelify Sans) |
| Safe Zone | Biến cấu hình (%), mặc định đáy cách ~13–15% chiều cao |

### 1.2 Danh sách asset cần làm
**Nhân vật (mỗi bộ thân; làm MVP 6–8 bộ khác màu/kiểu để hash ra)**
- `idle` (2–4 khung), `walk` 4 hướng hoặc 2 hướng + lật ngang (4–6 khung), `sit` (1–2 khung), `jump/flash` (spawn & mốc tim).
- Thân khuyết đầu, có điểm neo (anchor) để gắn avatar.
- Hiệu ứng "vắng" (mờ + icon zZ).

**Sân khấu**
- Sàn / nền sân chơi (tile lặp, nửa trong suốt để không che cảnh), viền sân.
- **5 ghế VIP**: ghế 1 lớn giữa có vương miện + hào quang động; ghế 2–5 đối xứng, tăng dần độ "sang".
- Bục / nền cho hàng VIP.

**UI trong Overlay**
- Name tag (chào 3 giây) và bảng VIP (tên + huy hiệu hạng 1–5 + điểm).
- Huy hiệu hạng, icon kim cương/quà.
- Hiệu ứng: spawn (poof), chớp sáng mốc tim, nhảy bật, lên ghế VIP (bay/chạy + sparkle), đá khỏi ghế.
- Dải trạng thái kết nối (chỉ hiện ở bản debug, ẩn khi live).

### 1.3 Quy trình & sản phẩm
1. **Moodboard + chọn phong cách** (bạn chọn: chibi dễ thương / retro 8-bit / hiện đại hơn). Mình đưa 2–3 hướng để bạn chọn.
2. **Mockup tĩnh** (HTML) hiển thị cảnh 9:16 và 16:9 với nửa trên trong suốt (caro), 5 VIP + ~15 nhân vật giả → duyệt bố cục, độ dày chữ, Safe Zone.
3. **Đồ họa vẽ bằng code**: thân, sân, ghế, hiệu ứng.
4. **Trang xem trước animation** (HTML): xem từng hoạt ảnh, thử ghép avatar thật vào đầu.

**Cách tạo asset (cần bạn chọn):**
- (a) Mình viết script sinh pixel-art bằng code (placeholder sạch, sửa nhanh, nhưng đơn giản).
- (b) Bạn/nhà thiết kế vẽ bằng Aseprite/Piskel theo spec. _(không chọn)_
- (c) Dùng bộ asset có sẵn. _(không chọn)_

**Xong khi:** mockup 9:16 và 16:9 được bạn duyệt; trang xem trước animation hiển thị đủ các hoạt ảnh.

---

## Bước 1b — Spike connector local  ✅ (đã thử với 2 phòng TikTok thật)
Chạy `tiktok-live-connector` trên máy local với một phòng đang live:
- Ghi log thô event `like`, `gift`, `member`; xác nhận trường `repeatCount`, `repeatEnd`, `diamondCount`.
- Quan sát có/không event rời phòng; tần suất like.
- Kết quả cập nhật vào mục "giả định cần xác nhận" của PRD.

## Bước 2 — Khung dự án & Backend lõi  ✅
- Cấu trúc `server/`, `overlay/`, `admin/`, `shared/`; SQLite (WAL, ghi theo lô).
- Interface Connector + `tiktokConnector.js` + placeholder `youtubeConnector.js`; trạng thái kết nối + reconnect backoff.
- Chuẩn hoá Normalized Event; Event Router (Source→Stage, 1-1 và N-1).
- Game engine theo Stage (server là nguồn chân lý): tim/ngưỡng, quà combo, bảng VIP, vắng, LRU slots, timeout.
- Unit test cho logic then chốt: vượt mốc tim, delta combo, tie-break, LRU.

## Bước 3 — Overlay Renderer  ✅
- Dựng renderer từ đồ họa ở bước 1; Canvas, khoá 30 FPS, scale pixel-perfect.
- Nhận snapshot + cập nhật qua Socket.IO; token Overlay; tham số `width/height`.
- Avatar proxy + cache ở backend; ghép đầu–thân theo hash.
- Hiệu ứng và chuyển động (Lerp, z-index, lên ghế VIP).

## Bước 4 — Admin Dashboard  ✅
- Đăng nhập; Sources/Stages/ghép nối; trạng thái kết nối; link OBS + token.
- Rules & Pricing; Live Controls (Kick, Reset); Safe Zone kéo chỉnh + xem trước.
- Test Panel (người xem test tự xoá sau 30 giây).

## Bước 5 — Kiểm thử hiệu năng & tích hợp  ✅ (đo server + overlay; chưa đo trong OBS thật)
- Giả lập 1000+ like/giây, 30 nhân vật + 5 VIP trong OBS Browser Source, đo FPS.
- OBS refresh, restart container, mất kết nối connector, Merge N-1.

## Bước 6 — Đóng gói & tài liệu  ✅ (Dockerfile, docker-compose.yml, README.md, docs/DO-HOA.md; chưa build Docker thật)
- `Dockerfile`, `docker-compose.yml`, volume SQLite; `.env.example`.
- Tài liệu: `.env`, thêm bộ thân mới, nhúng OBS, cấu hình `cloudflared`.

---

## Thứ tự phụ thuộc
```
Bước 1 (đồ họa) ──────────────► Bước 3
Bước 1b (spike) ─► Bước 2 ────► Bước 3 ─► Bước 4 ─► Bước 5 ─► Bước 6
```
Bước 2 có thể bắt đầu khi bước 1 đang chạy, vì không phụ thuộc đồ họa.

## Quyết định cần bạn chốt trước khi bắt đầu bước 1
1. Phong cách pixel-art (chibi / retro 8-bit / khác).
2. Cách tạo asset: (a) sinh bằng code, (b) bạn vẽ, hay (c) dùng asset có sẵn.
3. Chủ đề sân khấu (ví dụ quán cà phê, khán đài đấu trường, rạp hát…) để đồng bộ ghế VIP, sàn, màu.
