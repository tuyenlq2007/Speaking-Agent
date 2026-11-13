# SpeakRight

SpeakRight là ứng dụng web một trang giúp người Việt luyện phát âm tiếng Anh. Người học nhập một đoạn văn; ứng dụng tách đoạn và lần lượt phát, thu từng câu riêng biệt. Nếu trình duyệt chưa nhận ra đầy đủ, người học được thử lại câu hiện tại tối đa một lần rồi ứng dụng tự chuyển sang câu tiếp theo. Ứng dụng không phát hoặc yêu cầu đọc cả đoạn cùng lúc.

Người học có thể chọn **Traditional QA**, **AI QA** hoặc **Introduce Yourself** để tải ngẫu nhiên một đoạn mẫu. Sau khi luyện xong câu cuối, ứng dụng tự tải và bắt đầu đoạn tiếp theo trong cùng chủ đề. Các đoạn được xáo trộn và chỉ lặp lại sau khi hết danh sách; chủ đề có một đoạn sẽ luyện lại đoạn đó. Nút **Đổi chủ đề** kết thúc lượt luyện liên tục. Chỉnh sửa đoạn mẫu sẽ chuyển sang chế độ nhập đoạn riêng, có màn hình kết quả khi hoàn thành. Đoạn văn có thể dài tối đa 6.000 ký tự.

Phản hồi là kết quả nhận dạng từ gần đúng, không phải chấm điểm âm vị hay chất lượng giọng. Ứng dụng không có máy chủ riêng và không lưu bản ghi âm; dịch vụ nhận dạng của trình duyệt có thể xử lý âm thanh trực tuyến.

## Chạy dự án

```powershell
npm install
npm run dev
```

Mở địa chỉ Vite hiển thị trong terminal bằng Chrome hoặc Edge và cho phép dùng micrô.

## Kiểm tra và đóng gói

```powershell
npm test
npm run build
```

Thư mục `dist/` là bản tĩnh sẵn sàng triển khai lên Netlify. Cấu hình build đã có trong `netlify.toml`.

## Cấu trúc chính

- `src/domain/matcher.ts`: chuẩn hoá, tách từ và căn chỉnh chuỗi theo edit distance.
- `src/domain/sentences.ts`: tách đoạn văn thành các câu luyện riêng biệt.
- `src/domain/practiceFlow.ts`: máy trạng thái thuần cho toàn bộ lượt luyện.
- `src/services/speech.ts`: bộ chuyển đổi speech synthesis và speech recognition.
- `src/App.tsx`: giao diện và điều phối tác vụ trình duyệt.
- `tests/`: kiểm thử matcher, máy trạng thái và speech adapter.

## Hỗ trợ trình duyệt

Chrome và Edge hiện tại là mục tiêu chính. Trình duyệt không có `SpeechRecognition` vẫn hiển thị giải thích rõ ràng và vô hiệu hoá thao tác bắt đầu.
