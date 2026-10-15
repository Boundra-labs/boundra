# Person 2 — Progres implementasi

Rencana lengkap: [person-2-plan.md](./person-2-plan.md). Setiap fase berakhir dengan satu commit di branch `feat/person-2-integration` setelah seluruh kriteria fasenya terpenuhi dan diuji. Status di bawah mencerminkan hasil uji lokal yang benar-benar dijalankan, bukan target.

| Fase | Isi                                                         | Status     |
| ---- | ----------------------------------------------------------- | ---------- |
| 0    | Rencana, baseline lokal                                     | ✅ Selesai |
| 1    | Data model & migrasi (WS1)                                  | ✅ Selesai |
| 2    | Lease, job queue, `ExecutionStore`, `MonitorStore` (WS2)    | ⏳ Belum   |
| 3    | ACCE engine & mandate builder (WS5, WS6 bagian murni)       | ⏳ Belum   |
| 4    | Auth SIWE & API (WS3, WS4, WS6 bagian API)                  | ⏳ Belum   |
| 5    | Verifikasi otorisasi/funding & orkestrasi worker (WS6, WS7) | ⏳ Belum   |
| 6    | E2E chain lokal (anvil)                                     | ⏳ Belum   |
| 7    | Provider LLM (WS8)                                          | ⏳ Belum   |
| 8    | Benchmark runner (WS9)                                      | ⏳ Belum   |
| 9    | Dokumentasi, CI, PR                                         | ⏳ Belum   |

## Fase 0 — Rencana & baseline

Kriteria:

- [x] Rencana tertulis dan disetujui (`person-2-plan.md`).
- [x] Baseline lokal hijau sebelum perubahan: Foundry 31/31, chain 9/9, worker 11/11, shared 8/8, API 4/4, integrasi PostgreSQL 1/1, ESLint dan Prettier bersih.

Catatan lingkungan: mesin pengembang memakai Node 24, sedangkan repo mengunci Node 22.22 (`engine-strict`). Uji lokal dijalankan dengan memanggil binary langsung; CI tetap memakai Node 22.

## Fase 1 — Data model & migrasi

Migrasi `20261016000000_workflow_and_execution` menambah tabel workflow (`Question`, `PreferenceRecord`, `Executor`, `Mandate`, `Decision`, `ActionProposal`, `PolicyCheck`, `ActivityEvent`), port eksekusi/monitor (`Lease`, `EoaNonceReservation`, `TransactionAttempt`, `AttemptEvent`, `MonitorCursor`, `RiskEvent`) dan evaluasi (`EvaluationRun`, `EvaluationCaseResult`), serta kolom SIWE/CSRF untuk auth.

Kriteria:

- [x] Migrasi berlaku di database yang sudah ada (jalur upgrade) dan di database kosong (jalur CI).
- [x] Tidak ada drift antara database dan `schema.prisma` (`prisma migrate diff` kosong).
- [x] Constraint yang tidak bisa diekspresikan Prisma ada di migrasi: alamat lowercase, hash 0x, batas uint256/uint64/uint32, mask vault/aksi, komponen ordinal ACCE 0–3, budget 5 pertanyaan.
- [x] Partial unique index: satu mandat `AUTHORIZED` per executor, satu aksi non-terminal per executor, EOA nonce aktif unik per operator.
- [x] Tes integrasi PostgreSQL nyata: 5/5 lulus (`pnpm test:integration` sekarang menjalankan semua `tests/*.integration.ts`).
- [x] Typecheck API dan worker, ESLint, Prettier bersih.

Catatan: baris `AuthChallenge`/`AuthSession` lama dikosongkan oleh migrasi karena auth belum pernah diimplementasikan dan datanya sementara.
