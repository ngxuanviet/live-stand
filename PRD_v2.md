# PRD v2 — Hệ Thống Minigame Tương Tác Livestream 2D
**Multi-Source & Multi-Stage Architecture**

> Phiên bản 2: tích hợp các quyết định sau vòng đánh giá v1. Các mục thay đổi so với v1 được đánh dấu **[v2]**.

---

## 1. Tổng quan & Mục tiêu

- **Mục tiêu**: Sân khấu 2D pixel-art tương tác thời gian thực cho livestream (ưu tiên 9:16, hỗ trợ đa tỷ lệ), tăng tương tác và thúc đẩy donate, không che khung chat hay màn hình game chính.
- **Tech stack (gọn nhất có thể)**:
  - Backend: Node.js 22.13+ + `tiktok-live-connector` (bắt sự kiện công khai qua username).
  - Realtime: Socket.IO (hoặc WebSocket thuần).
  - Overlay: HTML5 Canvas / Phaser.js, nhúng qua Browser Source của OBS. **[v2]** Khoá **30 FPS**.
  - Admin Dashboard: Web UI nhẹ, có xác thực mật khẩu.
  - **[v2]** Lưu trữ: **SQLite** (chế độ WAL, ghi theo lô mỗi 1–2 giây), mount volume Docker. Không dùng Redis.
  - Triển khai: Docker / Docker Compose. **[v2]** HTTPS do `cloudflared` đảm nhiệm, không cần reverse proxy trong dự án.
- **Phát triển**: **[v2]** Kiểm thử connector trên máy local trước. Chỉ xử lý vấn đề VPS / IP datacenter nếu phát sinh thực tế.

---

## 2. Kiến trúc: Multi-Source & Multi-Stage

Tách hoàn toàn **Sources** (đầu vào) và **Stages** (đầu ra) qua **Event Router** ở backend.

### 2.1 Tầng 1 — Connectors / Sources
- Mô hình Adapter/Plugin, mỗi nền tảng một connector cùng interface.
- MVP: `tiktokConnector.js` (nhiều phòng TikTok đồng thời qua username).
- Placeholder: `youtubeConnector.js` (khung interface, chưa cài đặt).
- **[v2] Trạng thái kết nối** (hiển thị trên Dashboard, theo từng Source):

| Trạng thái | Ý nghĩa |
|---|---|
| `connecting` | Đang kết nối |
| `connected` | Đang nhận event (kèm thời điểm event cuối) |
| `offline` | Streamer chưa live, đang chờ phát |
| `reconnecting` | Mất kết nối, đang thử lại (số lần + thời gian chờ backoff) |
| `error` | Lỗi, kèm nội dung (sign server từ chối, bị chặn…) |

  - Reconnect với **exponential backoff**.
  - Cảnh báo "đã kết nối nhưng không có event nào trong X phút" để phát hiện kết nối chết ngầm.
  - Cho phép cấu hình proxy và `signApiKey` qua `.env` / Dashboard.
  - Ghim phiên bản thư viện; có thể thay bằng nhà cung cấp khác bằng cách viết connector mới.

### 2.2 Normalized Event **[v2]**
```
{
  eventId,          // duy nhất, chống xử lý trùng
  sourceId, platform,
  userKey,          // = "platform:userId" (xem 2.4)
  userId, username, avatar,
  eventType,        // join | like | gift | chat | leave(không đảm bảo)
  value,            // like: số tim của event; gift: xem bên dưới
  gift: { giftId, giftName, diamondValue, repeatCount, streakEnded },
  timestamp
}
```

### 2.3 Tầng 2 — Event Router
- Ánh xạ Source → Stage cấu hình trên Dashboard:
  - **1-1 (Độc lập)**: mỗi Stage nhận một Source.
  - **N-1 (Gộp)**: một Stage nhận nhiều Source.
  - Một Source có thể gắn vào nhiều Stage.
- **[v2] Trạng thái game thuộc Stage, không thuộc Source.**
  - Mỗi event tới mỗi Stage đúng một lần, nên Merge N-1 không bị cộng điểm hai lần.
  - Hai Stage cùng nguồn có điểm độc lập; reset từng Stage không ảnh hưởng Stage khác.
  - Khoá dữ liệu: `(stage_id, user_key)`.

### 2.4 Định danh người dùng **[v2]**
- `user_key = platform:userId` (ID nội bộ nền tảng, không đổi).
- `username` chỉ để hiển thị (có thể đổi).
- Cùng một người ở hai nền tảng được coi là **hai người khác nhau** (không có cách đáng tin để ghép).

### 2.5 Tầng 3 — Stages / Overlays
- Endpoint độc lập: `/overlay?stage_id=...&token=...&width=1080&height=1920`.
- **[v2] Token riêng cho mỗi Overlay URL**; admin có thể tạo lại token. Không có token hợp lệ thì không nhận dữ liệu.
- Canvas tự scale giữ độ sắc nét pixel-art; **nền trong suốt** (`background: transparent`).
- **[v2] Server là nguồn chân lý**: giữ toàn bộ trạng thái game. Overlay chỉ render; khi OBS refresh hoặc kết nối lại, overlay nhận **snapshot đầy đủ** rồi tiếp tục nhận cập nhật.

---

## 3. Layout chuẩn 9:16

- **[v2] Không lề:** canvas overlay chỉ chứa sân khấu, nội dung bắt đầu ngay mép trên; việc đặt vị trí trên màn hình dọc do OBS đảm nhiệm (kéo nguồn Browser). Không còn nửa trên trong suốt trong chính overlay.
- **[v2] VIP ngồi cao, đầu đè lên màn chiếu:** viền trên của sân (dải LED) nằm thấp hơn mép trên canvas một chút; đầu và vương miện của VIP nhô lên trên viền khoảng 8 pixel logic để chồng nhẹ lên màn chiếu.
- **Nửa dưới (~55–60%)**: sân khấu 2D.
  - Hàng trên cùng: **5 ghế VIP** cố định.
  - Bên dưới: sân chơi tự do (X, Y).
- **[v2] Chiều cao vùng sân** cấu hình được theo từng Stage (`fieldHeightPx`, px thật của canvas, 0 = tự lấp đầy): giới hạn dải nhân vật đi lại phía dưới hàng VIP; sân cỏ kết thúc ở giới hạn đó và phía dưới trong suốt.
- **[v2] Safe Zone** (chừa trống ở đáy) cấu hình được theo từng Stage, lưu theo **phần trăm chiều cao**, **mặc định 0** (không lề). Admin chỉnh trên Dashboard, có chế độ xem trước kèm khung chat mô phỏng. Tỷ lệ khác dùng cùng cơ chế.

---

## 4. Logic Game Cốt Lõi

### A. Sinh nhân vật & hiển thị tên
- Người mới vào phòng (`join`): **không** hiển thị nhân vật.
- Spawn khi người xem thả tim lần đầu.
- Tên hiện **một lần duy nhất 3 giây** lúc xuất hiện lần đầu rồi ẩn.
- **[v2]** Người đã ra (do timeout hoặc Max Slots) rồi quay lại: **giữ nguyên toàn bộ thông tin cũ** (tim, điểm, đã chào tên) cho tới khi admin reset Stage; không chào tên lại.

### A2. Hành động Follow / Chia sẻ / Bình luận **[v2]**
- Mỗi hành động `follow`, `share` hoặc `chat` được tính **đủ lượng tim cho mốc kế tiếp** của người đó (cộng đúng phần còn thiếu tới bội số kế tiếp của ngưỡng tim). Nhân vật di chuyển, nổi lên và chớp sáng như khi đạt mốc tim; người chưa có nhân vật thì xuất hiện.
- **Tên hiện lâu hơn** (mặc định 5 giây, so với 3 giây khi mới xuất hiện), kể cả với người đã từng được chào.
- **Khoảng nghỉ chống spam** cho từng người (mặc định 10 giây): trong khoảng nghỉ, hành động vẫn tính là hoạt động nhưng không được thưởng thêm.
- Với người đang ngồi ghế VIP, các hành động này không làm họ rời ghế hay đổi thứ hạng.
- Cấu hình theo Stage: `actionGreetSec`, `actionCooldownSec`. Test Panel có nút Simulate Follow / Share / Bình luận.

### B. Di chuyển & tăng layer
- Hệ thống cộng dồn tim theo người dùng trong phiên.
- **[v2] Ngưỡng cấu hình theo từng Stage** (mặc định 10): mỗi lần người dùng **vượt thêm một ngưỡng** thì kích hoạt.
  - Do TikTok **gộp nhiều lượt tap vào một event**, kiểm tra bằng `floor(tổng_mới / N) > floor(tổng_cũ / N)`, không dùng `% N == 0` để không bỏ lỡ mốc. Nếu một event vượt nhiều mốc cùng lúc, chỉ kích hoạt một lần.
  - Kích hoạt gồm: chọn tọa độ ngẫu nhiên mới và di chuyển mượt (Lerp); đẩy Z-Index lên trên cùng kèm hiệu ứng chớp / nhảy; sau 10–15 giây không có tim mới, Z-Index trở lại theo trục Y.
- Số tim theo người dùng là **xấp xỉ** (do gộp event) — chấp nhận trong thiết kế.

### B2. Hiệu ứng cho người thả nhiều tim **[v2]**
- **Hai loại mốc, admin tự đặt trên Dashboard, không có mặc định** (không có mốc nào = tính năng tắt):
  - **Mốc tích luỹ:** số `hearts` của một người cắt qua ngưỡng (vd 30, 100, 300) thì diễn hiệu ứng lớn một lần.
  - **Mốc dồn dập:** đủ X tim trong Y giây thì diễn hiệu ứng nhỏ; sau khi bắn có khoảng nghỉ 5 giây.
- "Tim" là số `hearts` hiển thị trong Dashboard, gồm cả thưởng follow, share, bình luận. Mốc dựa trên việc `hearts` **cắt qua** ngưỡng trong chính sự kiện nên khởi động lại server hay sửa ngưỡng sau này không làm bắn lại hay bắn hồi tố. Một event vượt nhiều mốc chỉ diễn mốc cao nhất; mốc tích luỹ thắng mốc dồn dập.
- **Chỉ diễn một lần**, không để lại huy hiệu hay quầng sáng.
- **Thư viện 7 hiệu ứng** (theo độ mạnh): nhảy cẫng, nhún nhảy, xoay vòng, pháo giấy, lộn nhào, phóng lên trời, pháo hoa. Mỗi mốc chọn một hiệu ứng.
- **VIP đang ngồi ghế cũng diễn như người thường:** đứng lên, bước ra trước ghế (ghế để trống, vương miện hạng 1 đi theo), diễn xong đi về ngồi lại.
- **Làm nổi bật người diễn:** luôn đứng trên cùng; đèn chiếu dưới chân (Tắt / Nhẹ / Mạnh, mạnh dần theo mốc); tuỳ chọn làm tối đám đông; bong bóng tên kèm dòng "xN tim!" luôn hiện và không bị cắt bởi giới hạn bong bóng; chế độ Mạnh cho người xung quanh ngước nhìn. Chỉ một người giữ tiêu điểm, tối đa 2 người đầy đủ, người thứ 3 trở đi chỉ nhảy nhẹ; tối đa 6 hoạt hoạ lớn cùng lúc.
- Cấu hình theo Stage: `tierTotal`, `tierBurst` (tối đa 8 mốc mỗi loại), `tierSpotlight`, `tierDim`. Nút **Xem thử** trên Dashboard (nhân vật sân hoặc từng ghế VIP, không đổi số tim) và nút "Thả tim liên tục" trong Test Panel.

### C. Top 5 Ghế VIP (theo quà tặng)
- **Giá trị quà**:
  - Đơn vị chuẩn là **diamond**, lấy từ danh sách quà của nền tảng theo `giftId`. Bảng quy đổi do admin nhập là dự phòng khi không tra được.
  - **Quà combo (streak)**: server giữ bộ nhớ `(userKey, giftId) → repeatCount đã tính`. Mỗi event tính `delta = repeatCount_mới − repeatCount_đã_tính`, cộng `delta × diamondValue`. Điểm tăng dần theo thời gian thực và không tính trùng. Khi `streakEnded` thì xoá bộ nhớ chuỗi.
- **Điều kiện xét**: mọi quà đều được ghi nhận. Ngưỡng tối thiểu do admin cấu hình quyết định ai đủ điều kiện ngồi ghế. **[v2]** Bảng xếp hạng luôn tự cập nhật; ai thay đổi vị trí và lọt top 5 thì được ngồi ghế tương ứng.
- **Xếp hạng**: ghế 1 ở giữa (lớn nhất, vương miện / hào quang); ghế 2–5 xếp đối xứng hai bên.
- **Hiển thị**: nhân vật chạy / bay từ sân lên ghế; tên, huy hiệu thứ hạng và tổng điểm quà hiển thị cố định.
- **Trùng điểm**: ưu tiên người đạt mốc đó trước (theo `timestamp`).
- **[v2] Trạng thái "vắng" thay cho kiểm tra rời phòng**:
  - TikTok không có sự kiện rời phòng đáng tin, nên **dùng "hoạt động gần nhất"**.
  - Người VIP không có event nào trong **N phút** (cấu hình được) chuyển sang **trạng thái "vắng"** (hiển thị mờ / biểu tượng riêng), **chưa xoá ghế**.
  - Nút **Kick** thủ công vẫn có trên Dashboard.
  - Cấu hình cho phép chọn: giữ ghế vĩnh viễn trong phiên, hoặc nhả ghế sau thời gian vắng dài (mặc định giữ).
- Điểm quà và hạng thuộc về Stage, chỉ xoá khi admin reset.

---

## 5. Nhân vật & Hình ảnh **[v2]**

- **Chủ đề (đã chốt)**: fan zone ban đêm trước màn hình khổng lồ ngoài trời, phong cách pixel-art chibi. Màn hình game (nằm phía trên overlay trong OBS) là phông nền; nhân vật **quay mặt ra camera** cổ vũ streamer, và **thỉnh thoảng ngước lên xem màn hình** (cá nhân ngẫu nhiên, và cả sân cùng ngước định kỳ; có thể kích hoạt khi có sự kiện lớn).
- **Cấu tạo nhân vật (đã chốt)**: đầu 26×26 px gồm 3 lớp: tóc/mũ phía sau (chọn theo hash `user_key`, 6 kiểu), **avatar người xem làm khuôn mặt (vùng 20×20 đơn vị logic, vẽ nét ở độ phân giải thật)**, tóc mái/vành mũ phía trước; **thân** 16×14 px mặc áo bóng đá (8 mẫu áo, chọn theo hash).
- **Xử lý avatar (client, cache 1 lần/người)**: cắt tròn ở giữa (lệch nhẹ lên để lấy mặt), thêm viền tối mảnh, vẽ ở **độ phân giải thật** của canvas (không pixel hoá, không giảm màu) để avatar nét; tóc, mũ và thân vẫn là pixel-art. Avatar lỗi hoặc là ảnh mặc định của nền tảng thì dùng mặt giả vẽ bằng code (tạo theo hash); đổi sang ảnh thật khi tải xong.
- **Bộ hoạt ảnh tối thiểu**: `idle` (2 khung), `walk` (4), `sit` (VIP), `jump` (chớp sáng mốc tim), `look` (ngước lên: mặt co dọc, lộ cằm, ánh sáng màn hình, tay chỉ lên), cùng 7 hiệu ứng thả tim (mục 4B2) vẽ bằng các hàm thuần theo tiến độ (`overlay/js/anims.js`). VIP vắng dùng hiệu ứng mờ và biểu tượng "zZ".
- **Cách tạo đồ họa**: toàn bộ sinh bằng code, không dùng asset có sẵn. Mockup tham chiếu: `design/mockup.html`. Mật độ hiển thị cần kiểm tra lại ở 30 nhân vật (đầu 26 px làm sân khá chật).
- Thêm hoặc đổi kiểu nhân vật bằng cách sửa các bảng màu và hàm vẽ trong code (xem `docs/DO-HOA.md`).

---

## 6. Bộ nhớ & Hiệu năng

- **Timeout**: nhân vật dưới sân ngừng tương tác quá **45 giây** (cấu hình) thì đi ra mép màn hình và biến mất.
- **Max Slots** (mặc định 30 mỗi Stage): vượt quá thì loại nhân vật có **lần tương tác gần nhất cũ nhất** (LRU). **VIP không tính vào Max Slots.** Dữ liệu người bị ẩn vẫn được lưu để khôi phục khi họ quay lại.
- **FPS**: khoá 30 FPS.
- **Throttle / batch**: server gộp event tim theo cửa sổ ngắn và giới hạn tần suất gửi xuống overlay. Mục tiêu kiểm thử: chịu được 1000+ like/giây mà không giật.
- **Persistence**: SQLite lưu trạng thái Stage, người dùng, điểm; khôi phục khi container restart giữa buổi live. Chỉ xoá khi admin reset.

---

## 7. Phiên live & Reset

- Không có khái niệm "phiên" tự động. **Phiên bắt đầu và kết thúc do admin quyết định** bằng nút Reset.
- **Reset Stage**: xoá nhân vật dưới sân (có thể kèm dữ liệu tim theo tuỳ chọn).
- **Reset VIP Leaderboard**: xoá bảng xếp hạng và điểm quà.
- Tuỳ chọn **Reset toàn bộ Stage** (xoá mọi dữ liệu của Stage).

---

## 8. Admin Dashboard

Có xác thực mật khẩu. Mọi API điều khiển và Test Panel **yêu cầu quyền admin**. (Không làm rate-limit đăng nhập.)

1. **Sources & Stages (định tuyến)**
   - Thêm / xoá / bật / tắt Source (username TikTok, placeholder YouTube ID); xem **trạng thái kết nối** từng Source (mục 2.1).
   - Tạo / sửa / xoá Stage: tên, `Width × Height`, Safe Zone, link nhúng OBS (kèm token, nút tạo lại token).
   - Giao diện ghép Source → Stage.
2. **Rules & Pricing** (theo từng Stage)
   - Ngưỡng tim cho mỗi lần kích hoạt (mặc định 10).
   - Timeout nhân vật (mặc định 45 giây), Max Slots (mặc định 30).
   - Ngưỡng giá trị quà tối thiểu để xét VIP (diamond); bảng quy đổi quà dự phòng.
   - Thời gian "vắng" của VIP và chính sách giữ / nhả ghế.
3. **Live Controls**
   - Danh sách Top 5 VIP kèm trạng thái và nút **Kick**.
   - **Reset Stage**, **Reset VIP Leaderboard**.
4. **Test Panel**
   - Thêm **người xem test** (tên tự chọn, gắn nhãn `simulated`); tự xoá sau **30 giây**.
   - Nút giả lập: `Simulate Join`, `Simulate +N Likes`, `Simulate Gift` (tên + giá trị tuỳ chọn, hỗ trợ giả lập combo), `Simulate Leave`.
   - Cho phép chọn Stage đích để không vô tình đổ event giả vào Stage đang live thật.

---

## 9. Yêu cầu phi chức năng

- **Bảo mật**: token Overlay; mật khẩu admin; Test Panel và API điều khiển cần quyền admin.
- **Quan sát**: endpoint health-check, log có cấu trúc, hiển thị trạng thái connector trên Dashboard.
- **Rủi ro cần ghi nhận**:
  - `tiktok-live-connector` là thư viện không chính thức (reverse-engineering), TikTok có thể đổi giao thức; phụ thuộc sign server của bên thứ ba (có giới hạn gói miễn phí, có thể cần `signApiKey`).
  - Điều khoản sử dụng của TikTok và giấy phép AGPL-3.0 của thư viện cần xem xét nếu phân phối hoặc thương mại hoá.
  - Giảm thiểu: kiến trúc Adapter cho phép đổi nhà cung cấp; có trạng thái kết nối và cảnh báo.
- **Giả định cần xác nhận khi test local**: các trường event quà (`diamondCount`, `repeatCount`, `repeatEnd`) và cách giá trị combo được tính; tần suất và dạng event like; có hay không event rời phòng.

---

## 10. Tiêu chí nghiệm thu (đo được)

- Overlay giữ 30 FPS trong OBS với 30 nhân vật và 5 VIP.
- Chịu 1000+ like/giây (giả lập) không mất đồng bộ.
- OBS refresh: overlay phục hồi đầy đủ trạng thái trong vài giây.
- Container restart: bảng VIP và điểm vẫn còn.
- Quà combo: tổng điểm khớp tổng diamond thực tế, không cộng trùng.
- Mất kết nối connector: Dashboard hiện đúng trạng thái và tự kết nối lại.
- Merge N-1: điểm không bị cộng hai lần.

---

## 11. Bàn giao

1. Source code đầy đủ (Backend + Overlay + Dashboard), cấu trúc module rõ ràng.
2. `Dockerfile` và `docker-compose.yml` để triển khai bằng một lệnh (kèm volume cho SQLite).
3. Tài liệu ngắn: cấu hình `.env`, nhúng Overlay vào OBS, cấu hình `cloudflared` (xem `README.md`), tuỳ chỉnh đồ họa (xem `docs/DO-HOA.md`).

> **Ghi chú trạng thái bàn giao:** `Dockerfile` và `docker-compose.yml` đã có và kiểm tra bố cục ảnh bằng cách mô phỏng cục bộ, nhưng **chưa build bằng Docker thật** (máy phát triển không có Docker). Đồ họa vẽ bằng code, cách tuỳ chỉnh nằm trong `docs/DO-HOA.md`.

---

## Phụ lục: Thay đổi chính so với v1

| # | Thay đổi |
|---|---|
| 1 | Bỏ kiểm tra "rời phòng"; dùng trạng thái "vắng" theo hoạt động |
| 2 | Ngưỡng tim cấu hình theo Stage; so sánh `floor` để không bỏ lỡ mốc |
| 3 | Quy đổi quà về diamond; cộng chênh lệch combo theo `repeatCount` |
| 4 | Trạng thái kết nối Source, reconnect backoff, cảnh báo im lặng |
| 5 | Khoá `platform:userId`; trạng thái game thuộc Stage |
| 6 | SQLite; reset thủ công; người quay lại giữ dữ liệu |
| 7 | Max Slots theo LRU, VIP tách riêng |
| 8 | Nhân vật = avatar + thân theo hash; bộ hoạt ảnh idle/walk/sit; cache avatar |
| 9 | Token Overlay, 30 FPS, snapshot đồng bộ, Safe Zone cấu hình được |
| 10 | Test Panel với người xem test tự xoá sau 30 giây |
