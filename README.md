# Trang web tạo file `.book`

Trang tĩnh chuyển **TXT / Aozora Bunko / EPUB** sang định dạng `.book` của máy đọc sách
tiếng Nhật (XIAO ESP32-S3 + EE05). Toàn bộ xử lý chạy trong trình duyệt — tệp không rời
khỏi máy người dùng, không cần máy chủ.

## Tệp

| Tệp | Vai trò |
|-----|---------|
| `index.html`   | Giao diện: kéo thả, sửa tiêu đề, chọn hướng đọc, cảnh báo ký tự thiếu, tải `.book`. |
| `converter.js` | Port 1:1 của `pc/book_converter.py` sang JavaScript (chạy cả trong trình duyệt lẫn node). |
| `entities.js`  | Bảng HTML5 entity + charref, **tự sinh** bởi `pc/make_web_assets.py` (khớp `html.unescape` của Python). |
| `glyphs.js`    | Bitmap các ký tự có trong phông atlas của máy (~6974), **tự sinh** từ `pc/out/glyph_index.bin`. |

`entities.js` và `glyphs.js` là tệp sinh ra — không sửa tay. Khi đổi phông atlas
(`pc/font_builder.py`) thì chạy lại:

```
python pc/make_web_assets.py
```

## Luồng dùng

1. Mở trang web, kéo thả tệp `.txt` / `.epub`, sửa tiêu đề nếu muốn, bấm **Tải .book**.
2. Trên máy đọc: menu → **WiFi転送**, nối WiFi `Reader-XXXX`, mở `http://192.168.4.1`,
   kéo tệp `.book` lên. Giữ「戻る」để tắt WiFi. Sách xuất hiện trong 本棚.

> Trang web dùng HTTPS nên không thể gửi thẳng tới máy (`http://192.168.4.1`);
> phải tải tệp về rồi upload qua trang của chính máy.

## Đăng lên GitHub Pages

1. Tạo repo mới trên github.com.
2. **Add file → Upload files**, kéo cả thư mục `web/` (4 tệp trên) vào, Commit.
3. **Settings → Pages** → Source *Deploy from a branch* → nhánh `main` / `/ (root)` → Save.
4. Đợi ~1 phút, mở đường link GitHub cấp.

## Kiểm thử đối chiếu

`converter.js` được kiểm tra khớp **từng byte** với `pc/book_converter.py` trên TXT,
Aozora (UTF-8/Shift-JIS/EUC-JP) và EPUB. Khác biệt duy nhất đã biết: tệp **hỏng nặng**
(không phải UTF-8/Shift-JIS/EUC-JP) — byte lỗi được thay bằng ký tự khác nhau giữa hai bên;
sách thật không gặp đường này.
