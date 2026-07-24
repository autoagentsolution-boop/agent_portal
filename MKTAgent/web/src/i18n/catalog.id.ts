// Indonesian catalog. Partial — missing keys fall back to English. See catalog.vi.ts for the contract.
import type { MessageKey } from './catalog.en';

export const id: Partial<Record<MessageKey, string>> = {
  'common.confirm': 'Konfirmasi',
  'common.cancel': 'Batal',
  'common.save': 'Simpan',
  'common.delete': 'Hapus',
  'common.close': 'Tutup',
  'common.retry': 'Coba lagi',
  'common.loading': 'Memuat…',
  'common.approve': 'Setujui',
  'common.reject': 'Tolak',
  'common.connect': 'Hubungkan',
  'common.reconnect': 'Hubungkan ulang',

  'credits.exhausted': 'Kredit Anda habis. Isi ulang untuk terus menjalankan agen.',
  'credits.grant.confirm': 'Ini akan menghabiskan sekitar {credits} kredit. Lanjutkan?',
  'credits.grant.title': 'Konfirmasi penggunaan kredit',

  'connect.required.title': 'Perlu koneksi',
  'connect.required.body': 'Hubungkan {platforms} untuk melanjutkan. Draf Anda sudah siap.',

  'approve.video.cost': 'Membuat video ini menghabiskan sekitar {credits} kredit. Setujui?',
  'approve.send.confirm': 'Setujui dan kirim email ini?',
  'approve.step.failed': 'Sebuah langkah gagal. Tinjau, lalu coba lagi atau setujui ulang.',

  'schedule.confirm_tail': 'Saya membaca waktu kirim sebagai {time}. Mohon konfirmasi apakah itu benar.',

  'confirm.delete.workspace': 'Hapus workspace "{name}"? Tindakan ini tidak dapat dibatalkan.',
  'confirm.delete.generic': 'Hapus "{name}"? Tindakan ini tidak dapat dibatalkan.',
  'confirm.lead.token.revoke': 'Cabut tautan pengumpulan ini? Formulir yang memakainya akan berhenti berfungsi.',

  'err.gmail_not_connected': 'Gmail belum terhubung. Hubungkan Google untuk mengirim email.',
  'err.invalid_grant': 'Koneksi Google Anda kedaluwarsa. Hubungkan ulang Google untuk terus mengirim.',
  'err.insufficient_credits': 'Kredit tidak cukup untuk tindakan ini. Isi ulang lalu coba lagi.',
  'err.gmail_send_failed': 'Email tidak dapat dikirim. Periksa koneksi Google Anda lalu coba lagi.',
  'err.no_recipient': 'Tidak ada penerima untuk email ini. Tambahkan penerima lalu coba lagi.',
  'err.network_error': 'Masalah jaringan — permintaan tidak sampai ke server. Periksa koneksi lalu coba lagi.',
  'err.validation_failed': 'Beberapa kolom perlu diperbaiki sebelum disimpan.',
  'err.invalid_ui_language': 'Bahasa antarmuka itu belum tersedia.',
  'err.generic': 'Terjadi kesalahan. Silakan coba lagi.',

  'notice.connect_to_publish': 'Hubungkan {platforms} untuk memublikasikan — draf Anda sudah siap.',
};
