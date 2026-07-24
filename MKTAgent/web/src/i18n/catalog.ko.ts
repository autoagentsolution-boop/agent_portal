// Korean catalog. Partial — missing keys fall back to English. See catalog.vi.ts for the contract.
import type { MessageKey } from './catalog.en';

export const ko: Partial<Record<MessageKey, string>> = {
  'common.confirm': '확인',
  'common.cancel': '취소',
  'common.save': '저장',
  'common.delete': '삭제',
  'common.close': '닫기',
  'common.retry': '다시 시도',
  'common.loading': '불러오는 중…',
  'common.approve': '승인',
  'common.reject': '거부',
  'common.connect': '연결',
  'common.reconnect': '다시 연결',

  'credits.exhausted': '크레딧이 모두 소진되었습니다. 충전하여 에이전트를 계속 실행하세요.',
  'credits.grant.confirm': '약 {credits} 크레딧이 소요됩니다. 계속할까요?',
  'credits.grant.title': '크레딧 사용 확인',

  'connect.required.title': '연결 필요',
  'connect.required.body': '{platforms}을(를) 연결하여 계속하세요. 초안이 준비되어 대기 중입니다.',

  'approve.video.cost': '이 영상 생성에는 약 {credits} 크레딧이 듭니다. 승인할까요?',
  'approve.send.confirm': '이 이메일을 승인하고 보낼까요?',
  'approve.step.failed': '단계가 실패했습니다. 검토한 후 다시 시도하거나 다시 승인하세요.',

  'schedule.confirm_tail': '보내는 시간을 {time}(으)로 이해했습니다. 맞는지 확인해 주세요.',

  'confirm.delete.workspace': '워크스페이스 "{name}"을(를) 삭제할까요? 되돌릴 수 없습니다.',
  'confirm.delete.generic': '"{name}"을(를) 삭제할까요? 되돌릴 수 없습니다.',
  'confirm.lead.token.revoke': '이 수집 링크를 취소할까요? 이를 사용하는 양식이 작동을 멈춥니다.',

  'err.gmail_not_connected': 'Gmail이 연결되어 있지 않습니다. 이메일을 보내려면 Google을 연결하세요.',
  'err.invalid_grant': 'Google 연결이 만료되었습니다. 계속 보내려면 Google을 다시 연결하세요.',
  'err.insufficient_credits': '이 작업에 필요한 크레딧이 부족합니다. 충전 후 다시 시도하세요.',
  'err.gmail_send_failed': '이메일을 보내지 못했습니다. Google 연결을 확인하고 다시 시도하세요.',
  'err.no_recipient': '이 이메일의 수신자를 찾을 수 없습니다. 수신자를 추가하고 다시 시도하세요.',
  'err.network_error': '네트워크 문제 — 요청이 서버에 도달하지 못했습니다. 연결을 확인하고 다시 시도하세요.',
  'err.validation_failed': '저장하기 전에 일부 항목을 수정해야 합니다.',
  'err.invalid_ui_language': '해당 인터페이스 언어는 아직 제공되지 않습니다.',
  'err.generic': '문제가 발생했습니다. 다시 시도해 주세요.',

  'notice.connect_to_publish': '{platforms}을(를) 연결하여 게시하세요 — 초안이 준비되어 대기 중입니다.',
};
