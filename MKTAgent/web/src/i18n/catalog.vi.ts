// Vietnamese catalog. Partial — any missing key falls back to English (catalog.en.ts). Keys are typed
// against the English source, so a typo'd key is a build error. Human-authored (native); phase 04's
// generator only fills MISSING keys and never overwrites these.
import type { MessageKey } from './catalog.en';

export const vi: Partial<Record<MessageKey, string>> = {
  'common.confirm': 'Xác nhận',
  'common.cancel': 'Huỷ',
  'common.save': 'Lưu',
  'common.delete': 'Xoá',
  'common.close': 'Đóng',
  'common.retry': 'Thử lại',
  'common.loading': 'Đang tải…',
  'common.approve': 'Duyệt',
  'common.reject': 'Từ chối',
  'common.connect': 'Kết nối',
  'common.reconnect': 'Kết nối lại',

  'credits.exhausted': 'Bạn đã hết tín dụng. Nạp thêm để tiếp tục chạy agent.',
  'credits.grant.confirm': 'Việc này tốn khoảng {credits} tín dụng. Tiếp tục?',
  'credits.grant.title': 'Xác nhận chi tín dụng',

  'connect.required.title': 'Cần kết nối',
  'connect.required.body': 'Kết nối {platforms} để tiếp tục. Bản nháp của bạn đã sẵn sàng.',

  'approve.video.cost': 'Tạo video này tốn khoảng {credits} tín dụng. Duyệt?',
  'approve.send.confirm': 'Duyệt và gửi email này?',
  'approve.step.failed': 'Một bước đã lỗi. Xem lại rồi thử lại hoặc duyệt lần nữa.',

  'schedule.confirm_tail': 'Tôi hiểu thời gian gửi là {time}. Vui lòng xác nhận có đúng không.',

  'confirm.delete.workspace': 'Xoá workspace "{name}"? Không thể hoàn tác.',
  'confirm.delete.generic': 'Xoá "{name}"? Không thể hoàn tác.',
  'confirm.lead.token.revoke': 'Thu hồi link thu thập này? Các form đang dùng nó sẽ ngừng hoạt động.',

  'err.gmail_not_connected': 'Gmail chưa được kết nối. Kết nối Google để gửi email.',
  'err.invalid_grant': 'Kết nối Google đã hết hạn. Kết nối lại Google để tiếp tục gửi.',
  'err.insufficient_credits': 'Không đủ tín dụng cho thao tác này. Nạp thêm rồi thử lại.',
  'err.gmail_send_failed': 'Không gửi được email. Kiểm tra kết nối Google rồi thử lại.',
  'err.no_recipient': 'Không tìm thấy người nhận cho email này. Thêm người nhận rồi thử lại.',
  'err.network_error': 'Sự cố mạng — yêu cầu chưa tới máy chủ. Kiểm tra kết nối rồi thử lại.',
  'err.validation_failed': 'Một số trường cần sửa trước khi lưu.',
  'err.invalid_ui_language': 'Ngôn ngữ giao diện đó chưa được hỗ trợ.',
  'err.generic': 'Đã có lỗi xảy ra. Vui lòng thử lại.',

  'notice.connect_to_publish': 'Kết nối {platforms} để đăng — bản nháp của bạn đã sẵn sàng.',
};
