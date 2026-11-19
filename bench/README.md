# Đo hiệu năng

## Tải server (không cần trình duyệt)

```bash
npm run bench -- <eventMỗiGiây> <sốNgườiXem> <giây> <sốOverlay>
npm run bench -- 20000 2000 8 3
```

Phát event giả qua Router + StageEngine + gộp patch + Socket.IO tới nhiều overlay thật, rồi in CPU, độ trễ, băng thông.
Lưu ý: trên Windows `setInterval` chỉ chính xác ~15 ms nên chỉ số "eventLoopTrễ" luôn quanh 16 ms; hãy xem độ trễ event→overlay.

## Tải overlay trong trình duyệt / OBS

```bash
npm run bench:stress -- 20000 3000 3056
```

In ra link overlay (có `debug=1`, nên có `window.__scene` để đo trong DevTools). Đặt link này vào Browser Source của OBS để xem FPS thật.

## Kết quả đo ngày 2026-11-18 (máy dev Windows 11, localhost)

Server, 3 overlay, 8 giây mỗi mức:

| Event/giây | Người xem | CPU (1 core) | Trễ event→overlay p95 | Băng thông / overlay | Patch/giây |
|---|---|---|---|---|---|
| 1.000 | 300 | 1,9% | 2 ms | 33 KB/s | 8,8 |
| 1.000 | 2.000 | 2,0% | 7 ms | 15 KB/s | 8,8 |
| 5.000 | 2.000 | 2,8% | 11 ms | 40 KB/s | 8,7 |
| 20.000 | 2.000 | 4,6% | 12 ms | 64 KB/s | 8,8 |

Overlay (trình duyệt trong app, 30 nhân vật + 5 VIP, 20.000 like/giây): 29,9 FPS, vẽ một khung ~1,1 ms, xử lý một patch ~0,04 ms, heap ~3,4 MB ổn định.

Khôi phục: tải lại trang overlay có đủ trạng thái sau ~50 ms (local); khởi động lại server giữa lúc đang chạy thì overlay tự kết nối lại, VIP và người dưới sân còn nguyên.
