# Ali — Tool dành cho mấy web cấm copy, khó lưu PDF

Nói thẳng: tool này sinh ra để trị mấy trang kiểu cấm chuột phải, chặn copy, chặn in, cuộn tới đâu mới load tới đó, ảnh lazy-load, nội dung ảo virtualized, feed kiểu Facebook cuộn mãi không hết, web 3D lồng iframe/canvas các kiểu.

Web ngoan hiền Ctrl+P phát ăn ngay thì bạn không cần tool này. Còn gặp web khó nhằn, quét mãi không đủ chữ, lưu PDF ra toàn trang trắng, ảnh mất sạch — thì mới tới lượt Ali.

Nguyên tắc của mình:

- Chạy ngay trong tab Chrome bạn đã đăng nhập. Không xin tài khoản, không gửi bài đi đâu, không AI vẽ lại nội dung.
- Chữ DOM giữ nguyên dạng chữ, copy / tìm kiếm được. Cái gì vốn đã là ảnh thì vẫn là ảnh, mình không OCR hộ.
- Ảnh nhúng thẳng vào HTML offline rồi mới in A4. In bằng hộp thoại chuẩn của Chrome, bật Background graphics lên là xong.
- Lỗi chỗ nào ghi rõ chỗ đó trong `.report.json`, thiếu ảnh thì đánh dấu ô trống chứ không ỉm đi.

Hợp nhất với bài học kiểu Edubit: 1 cột câu hỏi dài, có ảnh, có đáp án. Còn feed Facebook, web 3D bay nhảy thì quét cho vui thôi, đừng mong 1 phát ăn cả cái newsfeed.

Thấy chưa hợp web của bạn? Tải code về tự chế đi. Code để hết trong `src/` với `extension/`, không khóa gì cả.

## Cài phát dùng luôn

Mình dùng bản extension là chính, file nằm sẵn ở `extension/`, hiện tại là `v2.4.0`.

1. Chrome gõ `chrome://extensions`
2. Bật **Developer mode**
3. **Load unpacked** → trỏ vào thư mục `extension` trong code tải từ GitHub (chỗ có `manifest.json`)
4. Ghim **Ali · Web to PDF** ra ngoài cho dễ bấm

Không cần `npm install` để xài extension. Nhớ đừng xóa cái thư mục đó đi, Chrome nó đọc trực tiếp đấy. Sửa code xong thì vào `chrome://extensions` bấm reload, F5 lại trang học là có bản mới.

## Dùng như nào?

1. Đăng nhập web như bình thường, mở bài cần lấy.
2. Bấm icon Ali → **Kéo chọn vùng**, khoanh đúng cột nội dung. Khung cam là cái sẽ quét, bao gồm cả phần chưa cuộn tới, không phải chỉ chỗ bạn đang nhìn.
3. Bấm **Dùng vùng này**. Web nào bấm số mới hiện từng câu thì chuyển sang chế độ từng câu, khoanh luôn cả thanh số.
4. Bấm **Quét bài này**, ngồi yên đừng đổi tab để nó tự cuộn + chờ ảnh load.
5. Bấm **Tạo bản in / Lưu PDF** → tab bản in hiện ra → **In / Lưu PDF** → chọn **Save as PDF**, A4, tick **Background graphics** → Save.

Quét nhiều bài thì vào tab **Nhiều bài**, ném list URL vào (mỗi dòng 1 link). Điều kiện duy nhất: mấy bài đó phải cùng layout với bài mẫu bạn đã chọn vùng. Khác layout là toang, khỏi thắc mắc.

File đã quét nằm ở mục **Đã lưu**, lưu trong máy bạn thôi. Quan trọng thì tải PDF/HTML ra ngoài cất, xóa extension là mất sạch ráng chịu.

## Mấy ca khoai và cách xử

**1. Web cấm copy, disable chuột phải?**
Kệ nó. Mình đọc thẳng DOM chứ không thèm bấm copy, nên mấy cái script chặn copy vô tác dụng.

**2. Ảnh thấy trên web mà mất trong bản lưu?**
Ca này kinh điển. 99% do ảnh nằm domain khác (CDN, `*.fbcdn.net`...) nên Chrome không cho sờ vào.

Xử lý:

- Panel hỏi **Cho phép nguồn ảnh / font** thì Allow đi, đừng sợ, nó chỉ xin đúng domain có ảnh bài học. Xong quét lại.
- Lười quét lại thì giữ nguyên tab gốc, mở bản xem trước bấm **In từ trang gốc để lấy ảnh**. Cách này in ké phiên đăng nhập nên mấy ảnh khó cũng lòi ra.
- Bản cũ đã thành ô trống rồi thì quét lại từ đầu cho nhanh, đừng cố cứu.

Từ v2.4.0 nếu tải byte thất bại thì tool tự thử moi ảnh đã hiện trên trang ở size gốc lưu PNG. Lấy kiểu gì thì mở `.report.json` ra mà xem.

**3. Web load dần, cuộn mới hiện, Facebook-like?**
Tool có tự cuộn + chờ ảnh, nhưng feed vô hạn thì không ai hứa quét hết được. Bấm **Dừng** thì nó giữ phần đã quét được và ghi rõ là bản dở. Đừng cầm bản dở đi bảo tool lỗi.

**4. Iframe / canvas / chữ trong ảnh?**
- Chữ trong ảnh vẫn là ảnh. Không OCR.
- Canvas giữ được thì giữ dạng ảnh.
- Iframe thì tự mở frame đó thành tab riêng mà quét. Tool không tự chui vào iframe hộ bạn.

**5. Cài Ruler hay thước đo gì đó?**
Tắt đi trước khi kéo vùng. Nó bắt chuột là khỏi kéo.

Chi tiết mình vứt hết trong `extension/help.html` rồi, mở bằng Chrome mà đọc.

## Bản dòng lệnh — cho ai thích gõ

Ít dùng, nhưng vẫn chạy được. Cần Node.js + Chrome.

```powershell
.\Cai-dat.cmd
.\Chay-cong-cu.cmd
```

Chạy list URL:

```powershell
node src/cli.mjs --urls lesson-urls.txt
```

Copy `lesson-urls.example.txt` thành `lesson-urls.txt`, mỗi dòng 1 link. Chạy auto thì thêm `--selector "CSS_CUA_COT_NOI_DUNG"`.

Mỗi lần chạy đẻ ra thư mục `output/pdf/run-...`, mỗi bài có `.pdf`, `.html`, `.report.json`. Thiếu câu / thiếu ảnh mà không thêm `--allow-incomplete` thì nó dừng, khỏi xin bản nháp.

## Thích thì vọc code

Code dùng chung ở `src/dom.mjs`. Muốn chế cho web riêng của bạn thì cứ fork mà sửa selector, cách cuộn, cách chờ ảnh.

Sửa xong chạy:

```powershell
npm run build:extension
```

rồi reload extension.

Test thì toàn chạy localhost, không cần acc thật:

```powershell
npm test
npm run test:all
```

Có test riêng cho kéo vùng (`test:selection`), dừng giữa chừng (`test:regression`), xin quyền ảnh (`test:resources`). Đọc tên là biết.

## Nói trước kẻo lại hỏi

- Lúc quét cần mạng để tải bài / ảnh / font. Lưu xong rồi thì offline đọc thoải mái.
- Chỉ lấy được cái bạn đã có quyền xem sau khi đăng nhập. Web chặn bot gắt quá thì chịu, mình không bypass hộ.
- In qua Chrome nên ảnh có thể bị nén lại. Muốn giữ byte gốc thì mở file HTML offline mà soi.
- Không tự làm bài hộ, không nộp bài hộ, không mở khóa hộ. Tool lưu tài liệu thôi, không phải tool hack điểm.
