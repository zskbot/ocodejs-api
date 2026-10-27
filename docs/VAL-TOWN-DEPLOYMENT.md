# Triển khai Identity lên Val Town

Workflow triển khai được cố ý đặt ở chế độ **chạy thủ công**. Push code lên GitHub hoặc merge PR sẽ không tự sửa Val Town.

## 1. Thêm token an toàn

1. Mở GitHub repo: https://github.com/zskbot/ocodejs-api
2. Vào **Settings → Secrets and variables → Actions → New repository secret**.
3. Đặt **Name** chính xác là `VAL_TOWN_API_KEY`.
4. Dán Val Town API token vào ô **Secret**, sau đó lưu.
5. Token cần quyền đọc và ghi vals (`val:read` + `val:write`). Không lưu token trong file, README hoặc commit.

Không gửi token qua ChatGPT. GitHub Actions chỉ truyền token cho các bước cần gọi Val Town.

## 2. Chạy kiểm tra trước khi triển khai

Sau khi workflow được đưa vào `main`:

1. Mở tab **Actions** của repo.
2. Chọn **Deploy identity to Val Town**.
3. Bấm **Run workflow** và chọn `verify-only`.
4. Xác nhận bước type-check, test bảo mật và backup đều xanh. Artifact backup được giữ 14 ngày.

Chế độ này không sửa Val Town.

## 3. Triển khai có chủ đích

Chỉ sau khi bước kiểm tra và backup thành công:

1. Mở lại **Actions → Deploy identity to Val Town → Run workflow**.
2. Chọn `deploy`.
3. Kiểm tra log bước **Deploy to the existing Val Town val**.

Workflow clone val hiện tại trước, tạo artifact backup rồi mới overlay `index.ts`, `deno.json`, `backend/` và `public/`. Nó không xóa file chỉ có trên Val Town. Val Town cũng lưu lịch sử phiên bản riêng.

## Phạm vi

- Target: `ocodejs/velclaw-identity`
- Source: `velclaw-identity/` trong repo này
- CI: `deno task check` và `deno task test`
- Không tự deploy khi push/merge.
- Workflow không đồng bộ các file website ở repo root vào Val Town.
