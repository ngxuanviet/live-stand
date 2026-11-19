# Khán đài live

Sân khấu 2D pixel-art chibi tương tác thời gian thực cho livestream TikTok. Người xem thả tim, follow, chia sẻ, bình luận thì nhân vật xuất hiện và di chuyển trên sân; ai tặng quà nhiều nhất ngồi vào Top 5 ghế VIP. Overlay có nền trong suốt, nội dung bắt đầu ngay mép trên và không có lề, nhúng vào OBS Studio qua Browser Source rồi đặt vị trí ngay trong OBS.

Chạy trên VPS bằng Docker, không tốn tài nguyên máy chơi game. Đặc tả: [PRD_v2.md](PRD_v2.md). Kế hoạch: [PLAN.md](PLAN.md).

```
TikTok (username) ─► Connector ─► Event Router ─► Stage (logic game) ─► Overlay (OBS)
                      (nguồn)      (ghép nối)        (trạng thái)            ▲
                                                         ▲                   │ Socket.IO
                                         Admin Dashboard ┴───────────────────┘
```

## 1. Cài đặt bằng Docker (một lệnh)

Yêu cầu: máy có Docker và Docker Compose v2.

```bash
git clone <địa-chỉ-repo> khan-dai-live && cd khan-dai-live
cp .env.example .env
# sửa .env: ít nhất ADMIN_PASSWORD và SESSION_SECRET
docker compose up -d --build
```

Mở `http://localhost:3000/admin` (trên VPS: dùng cloudflared ở mục 5, hoặc đặt `BIND_ADDR=0.0.0.0`). Đăng nhập bằng `ADMIN_PASSWORD`.

Lệnh hay dùng:

```bash
docker compose logs -f app        # xem log
docker compose restart app        # khởi động lại
docker compose up -d --build      # cập nhật sau khi kéo code mới
docker compose down               # dừng (dữ liệu vẫn giữ trong volume)
```

> Lưu ý: `ADMIN_PASSWORD` và `SESSION_SECRET` là bắt buộc. Nếu để giá trị mẫu trong `.env.example`, server từ chối chạy ở chế độ production; thiếu một trong hai thì `docker compose` báo lỗi ngay.

## 2. Biến môi trường (`.env`)

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `ADMIN_PASSWORD` | Có | Mật khẩu đăng nhập trang Admin |
| `SESSION_SECRET` | Có | Chuỗi bí mật ký phiên đăng nhập. Đổi chuỗi này thì mọi phiên đăng nhập cũ hết hiệu lực |
| `PUBLIC_BASE_URL` | Nên đặt | Địa chỉ công khai, không có `/` cuối (vd `https://live.example.com`). Dashboard dùng để tạo link Overlay đầy đủ cho OBS |
| `SIGN_API_KEY` | Không | API key của sign server Euler Stream, nâng giới hạn kết nối TikTok. Để trống = gói miễn phí |
| `AVATAR_HOSTS` | Không | Thêm máy chủ ảnh avatar được phép tải, phân tách dấu phẩy. Mặc định đã có các CDN của TikTok |
| `TIKTOK_EXTENDED_GIFT_INFO` | Không | `1` = tải danh sách quà. Cần gói Business của Euler Stream, nên mặc định `0` |
| `TIKTOK_DEBUG_LOG` | Không | `1` = ghi mẫu event thô vào `data/raw-events.jsonl` để kiểm tra trường dữ liệu |
| `BIND_ADDR`, `HOST_PORT` | Không | (Docker) địa chỉ/cổng mở trên máy chủ, mặc định `127.0.0.1:3000` |
| `TUNNEL_TOKEN` | Khi dùng tunnel | (Docker) token Cloudflare Tunnel, xem mục 5 |
| `PORT`, `DB_PATH` | Không | Chỉ khi chạy không qua Docker (mặc định `3000`, `./data/app.db`) |

Dữ liệu (SQLite và cache avatar) nằm ở volume `data` của Docker (`/app/data` trong container).

## 3. Dùng lần đầu

1. **Nguồn & Sân khấu → Sân khấu:** tạo sân khấu, chọn kích thước (dọc 1080×1920 là mặc định).
2. **Nguồn dữ liệu:** thêm nguồn TikTok, nhập username (không cần `@`). Nguồn chỉ kết nối được khi streamer đang live; nếu chưa live sẽ hiện "Chưa live, đang chờ" và tự thử lại.
3. **Ghép nối:** tick ô sân khấu ở dòng của nguồn. Một sân khấu có thể nhận nhiều nguồn, một nguồn có thể đổ vào nhiều sân khấu.
4. **Luật & Giá:** chỉnh số tim mỗi lần di chuyển, timeout, số nhân vật tối đa, ngưỡng quà để vào VIP, thời gian hiện tên, chiều cao vùng sân (giới hạn dải nhân vật đi lại, 0 = tự lấp đầy) và chừa trống đáy (Safe Zone, mặc định 0); đều xem trước ngay bên phải.
5. **Test Panel:** thử mọi luồng (join, tim, quà, follow, share, bình luận) mà không cần phòng live thật. Người xem test có nhãn "test" và tự xoá sau 30 giây.
6. **Điều khiển trực tiếp:** xem Top 5 VIP (có nút Kick), Reset sân khấu, Reset bảng VIP khi bắt đầu phiên mới.

### Bình chọn 2 đáp án

Tab **Điều khiển trực tiếp → Bình chọn 2 đáp án**: nhập câu hỏi, tên và từ khoá của hai đáp án (mặc định bình luận `1` hoặc `2`), thời lượng, rồi bấm **Bắt đầu**.

- Người xem bình luận đúng từ khoá (không phân biệt hoa/thường và khoảng trắng thừa) thì nhân vật của họ đứng sang nửa sân của đáp án đó: A bên trái, B bên phải. Được đổi ý khi đang bình chọn; mỗi người một phiếu. Người chưa có nhân vật sẽ xuất hiện luôn ở đúng nửa sân.
- Overlay chỉ thêm một dải mảnh ngay trên mép sân (tên + số phiếu hai bên, câu hỏi + đồng hồ đếm ngược ở giữa, thanh tỉ lệ) và tô nhạt hai nửa sân. Không có khung hay banner lớn.
- VIP đã bầu thì rời ghế, xuống đứng thành một hàng ở phía trên nửa sân của phe mình như "lead": có vòng sáng màu phe dưới chân, hào quang, vương miện, tên và điểm quà luôn hiện, và luôn nổi trên các nhân vật khác. VIP chưa bầu vẫn ngồi ghế. Hết bình chọn (hoặc huỷ) thì VIP đi về ghế.
- Hết giờ (hoặc bấm **Kết thúc ngay**) hiện kết quả vài giây, nhân vật phe thắng nhảy ăn mừng, rồi sân trở lại bình thường. **Huỷ** thì bỏ ngay, không hiện kết quả.
- Mỗi sân khấu có một bình chọn tại một thời điểm; không lưu vào database nên khởi động lại server là kết thúc.
- Cần nội dung bình luận từ TikTok. Lần đầu dùng hãy thử với live thật; nếu không nhận phiếu, bật `TIKTOK_DEBUG_LOG=1` và kiểm tra tên trường chứa nội dung bình luận trong `data/raw-events.jsonl` (hiện đọc `comment`, `content`, `text`).

### Luật chơi tóm tắt

- Người xem chỉ xuất hiện khi thả tim, tặng quà, follow, share hoặc bình luận; tên hiện một lần (3 giây) lúc mới xuất hiện.
- Cứ vượt thêm mỗi N tim (mặc định 10) thì nhân vật di chuyển và nổi lên trên cùng. Follow, share, bình luận được tính đủ tim cho mốc kế tiếp và hiện tên lâu hơn (5 giây), có khoảng nghỉ 10 giây chống spam.
- Quà quy đổi ra diamond. Tổng quà cao nhất ngồi ghế số 1 (giữa), hoà điểm thì ai đạt trước thắng.
- TikTok không báo người xem rời phòng. VIP không hoạt động quá lâu chỉ hiện trạng thái "vắng"; có thể chọn nhả ghế.
- Sân đầy (mặc định 30) thì đẩy người tương tác cũ nhất; người mới không đẩy được ai ở lại chưa đủ 5 giây.

## 4. Nhúng vào OBS Studio

1. Dashboard → **Nguồn & Sân khấu → Sân khấu**, bấm **Copy** ở ô link Browser Source (có token riêng của sân khấu).
2. OBS: **Sources → + → Browser**. Dán link vào **URL**.
3. Đặt **Width** và **Height** đúng bằng kích thước sân khấu (vd `1080` × `1920`). **FPS: 30**.
4. Để trống ô **Custom CSS** (xoá đoạn CSS mặc định của OBS nếu có), vì nền overlay đã trong suốt.
5. Bỏ tick **Shutdown source when not visible** để overlay giữ trạng thái khi chuyển cảnh.
6. Xếp nguồn Browser **trên** nguồn game và webcam. Nội dung overlay bắt đầu ngay mép trên của canvas, không chừa lề: kéo nguồn trong OBS cho mép trên của overlay nằm ở mép dưới màn chiếu/khung game. Đầu các VIP (và vương miện hạng 1) cố ý nhô lên trên viền dải đèn khoảng 8 pixel logic, nên sẽ chồng nhẹ lên màn chiếu.
7. Kích thước Stage quyết định vùng sân dưới hàng VIP: càng cao, nhân vật càng thưa. Muốn giữ Stage cao nhưng chỉ cho nhân vật đi lại trong một dải thấp hơn, đặt **Chiều cao vùng sân** (px) ở **Luật & Giá**: sân cỏ dừng ở giới hạn đó và phía dưới trong suốt (0 = tự lấp đầy). Gợi ý: 1080×1080 (vuông) hoặc 1080×1920 (dọc); chiều cao nên từ khoảng 500 px trở lên. Muốn chừa khoảng trống ở đáy để tránh khung chat của TikTok thì chỉnh Safe Zone ở **Luật & Giá**, hoặc đơn giản là dịch/cắt nguồn trong OBS.

Overlay tự đồng bộ lại khi OBS làm mới hoặc server khởi động lại. Nếu đổi token (nút "Token mới"), link cũ ngừng hoạt động và cần dán link mới.

Tham số URL tuỳ chọn (chủ yếu để thử ngoài OBS): `width`, `height` (đè kích thước), `bg=checker|game|black` (nền xem thử), `fit=1` (co theo cửa sổ), `debug=1` (hiện FPS), `safe=1` (vẽ khung Safe Zone).

## 5. Cloudflare Tunnel (HTTPS, không mở cổng)

1. Cloudflare Zero Trust → **Networks → Tunnels → Create a tunnel** (loại Cloudflared), sao chép **token**.
2. Thêm **Public hostname**, ví dụ `live.example.com`, **Service** = `http://app:3000`.
3. Trong `.env`:
   ```
   TUNNEL_TOKEN=<token>
   PUBLIC_BASE_URL=https://live.example.com
   ```
4. Chạy kèm tunnel:
   ```bash
   docker compose --profile tunnel up -d --build
   ```

Nên bảo vệ thêm đường dẫn `/admin` và `/api` bằng Cloudflare Access (chỉ cho email của bạn). Link overlay có token riêng nên OBS vẫn dùng được bình thường.

## 6. Tuỳ chỉnh đồ họa

Toàn bộ đồ họa được vẽ bằng code (không dùng ảnh có sẵn). Cách đổi màu áo, kiểu tóc, mũ, ghế VIP và nền: xem [docs/DO-HOA.md](docs/DO-HOA.md).

## 7. Xử lý sự cố

| Hiện tượng | Nguyên nhân và cách xử lý |
|---|---|
| Nguồn báo "Chưa live, đang chờ" | Streamer chưa bắt đầu live. Nguồn tự thử lại mỗi 30 giây |
| Nguồn báo lỗi `SignatureMissingTokensError ... Business plan` | Đang bật `TIKTOK_EXTENDED_GIFT_INFO=1` mà không có gói Business. Đặt lại `0` |
| Nguồn báo "Đã kết nối" nhưng nhãn "im lặng" | Phòng không có event nào trong 5 phút (có thể vắng người, hoặc kết nối chết ngầm). Thử tắt rồi bật lại nguồn |
| Nguồn lỗi liên tục, thử lại với thời gian chờ tăng dần | TikTok đổi giao thức hoặc bị giới hạn. Thử đặt `SIGN_API_KEY`, cập nhật thư viện (`npm update tiktok-live-connector`), xem log |
| Overlay trắng/trống trong OBS | Kiểm tra link còn đúng token, kích thước Browser Source, và Dashboard xem trước có hiện không |
| Nhân vật hiện mặt giả thay vì ảnh người xem | Avatar chưa tải xong, bị lỗi, hoặc host không có trong danh sách cho phép (thêm vào `AVATAR_HOSTS`) |
| Chữ tên hiển thị font lạ | Máy chạy OBS không tải được font Pixelify Sans từ Google Fonts; vẫn đọc được nhưng kém đẹp |
| `docker compose` báo thiếu `ADMIN_PASSWORD` | Chưa có file `.env` hoặc chưa đặt biến, xem mục 1 |

## 8. Vận hành

- **Sao lưu:** dữ liệu ở volume `data`. Ví dụ: `docker run --rm -v khan-dai-live_data:/d -v "$PWD":/b alpine tar czf /b/backup.tgz -C /d .` (tên volume có thể khác, xem `docker volume ls`).
- **Tắt đột ngột:** trạng thái được lưu mỗi ~2 giây và khi tắt bình thường; mất điện hoặc `kill -9` có thể mất tối đa ~2 giây dữ liệu.
- **Phiên live:** hệ thống không tự bắt đầu/kết thúc phiên. Bấm **Reset bảng VIP** (và **Reset sân khấu**) ở tab Điều khiển trực tiếp khi bắt đầu phiên mới.

## 9. Phát triển

```bash
npm install
cp .env.example .env
npm run dev          # chạy có tự khởi động lại
npm test             # 50 test (logic game, router, API, bảo mật, trích xuất dữ liệu TikTok)
npm run bench        # đo tải server, xem bench/README.md
```

Cần Node 22.13 trở lên. Cấu trúc:

| Thư mục | Vai trò |
|---|---|
| `server/connectors/` | Nguồn dữ liệu: `Connector` (lớp cơ sở + trạng thái), `tiktokConnector`, `youtubeConnector` (placeholder) |
| `server/core/stageEngine.js` | Logic game của một Stage (thuần, có test) |
| `server/core/hub.js` | Quản lý Source/Stage, Event Router, lưu SQLite, Test Panel |
| `server/http/` | Đăng nhập, REST API `/api`, Socket.IO, proxy avatar |
| `shared/events.js` | Định dạng Normalized Event |
| `overlay/` | Overlay Canvas (đồ họa trong `js/art.js`) |
| `admin/` | Trang quản trị |
| `design/mockup.html` | Mockup đồ họa ban đầu |
| `bench/` | Đo hiệu năng, spike TikTok (`node bench/spikeTiktok.mjs <username>`) |

### API (cần đăng nhập, trừ `/api/login`)

- `POST /api/login {password}`
- `GET/POST /api/sources`, `PUT/DELETE /api/sources/:id`, `PUT /api/sources/:id/routes {stageIds}`
- `GET/POST /api/stages`, `PUT/DELETE /api/stages/:id`, `POST /api/stages/:id/token`
- `GET /api/stages/:id/state`, `POST .../reset`, `.../reset-vip`, `.../reset-all`, `.../kick {userKey}`
- `POST /api/stages/:id/poll {question, labelA, labelB, keywordA, keywordB, durationSec, resultSec}`, `POST .../poll/end`, `DELETE .../poll`
- `POST /api/stages/:id/simulate {type: join|like|gift|leave|chat|follow|share, username, value, diamondValue, ...}`
- `GET /api/status` (trạng thái kết nối các nguồn)

## 10. Rủi ro và lưu ý

- Kết nối TikTok dùng thư viện không chính thức (`tiktok-live-connector`), dựa trên giao thức nội bộ của TikTok và một sign server bên thứ ba. TikTok có thể đổi giao thức bất kỳ lúc nào. Việc thu thập dữ liệu kiểu này có thể không phù hợp điều khoản dịch vụ của TikTok.
- Thư viện đó dùng giấy phép AGPL-3.0; hãy xem điều kiện nếu bạn phân phối hoặc bán hệ thống.
- Chỉ có một mật khẩu quản trị chung và không giới hạn số lần đăng nhập sai. Nên đặt sau cloudflared/Access hoặc tường lửa, dùng mật khẩu dài.
