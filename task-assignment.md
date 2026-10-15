# Boundra — Pembagian Tugas 3 Orang

**Acuan:** [PRD v0.3](./prd.md), khususnya §6, §9–11, §13, dan §15.

**Status:** Rencana kerja; belum menandakan implementasi atau pengujian sudah selesai.

**Target bersama:** MVP testnet end-to-end yang dapat dioperasikan, diuji, dan didemokan dengan bukti nyata.

## 1. Pembagian utama

| Anggota | Peran | Hasil utama |
| --- | --- | --- |
| **Person 1** | Smart Contracts & Blockchain Execution | Kontrak aman sesuai scope, deployment, deposit/withdraw, monitoring chain dan recovery transaksi |
| **Person 2** | Backend, ACCE & Data | API, autentikasi, PostgreSQL, klarifikasi adaptif, mandate draft, workflow dan evaluasi AI |
| **Person 3** | Frontend, Delivery & Demo QA | UI lengkap, integrasi wallet, CI/deployment aplikasi, browser E2E dan evidence demo |

Semua orang menulis tests untuk modulnya. Person 3 mengoordinasikan E2E, tetapi tidak mengambil alih tanggung jawab correctness backend atau kontrak. Person 2 menjadi integration coordinator untuk schema dan workflow; Person 1 memegang keputusan interface kontrak; Person 3 memegang konfigurasi build/deployment bersama.

## 2. Batas folder dan kepemilikan

Struktur di bawah adalah target scaffold, belum merupakan folder yang sudah tersedia.

| Folder / artefak | Owner perubahan | Reviewer |
| --- | --- | --- |
| `contracts/` | Person 1 | Person 2 |
| `packages/chain/` — ABI, manifest types, typed chain adapter | Person 1 | Person 2 |
| `apps/worker/src/chain/` — signer, monitor, receipt/reorg reconciliation | Person 1 | Person 2 |
| `apps/api/` | Person 2 | Person 3; Person 1 untuk jalur authority |
| `apps/worker/src/orchestration/` — jobs, decision loop, verifier | Person 2 | Person 1 |
| `apps/worker/src/main.ts` dan lifecycle worker | Person 2 | Person 1 |
| `packages/shared/` — DTO/schema, errors, workflow types | Person 2 | Person 1 dan Person 3 |
| `packages/database/` — Prisma schema, migrations, repositories, job leases | Person 2 | Person 1 |
| `evaluation/runner/` dan `evaluation/baselines/` | Person 2 | Person 3 |
| `evaluation/fixtures/` dan `evaluation/reports/` | Person 3 | Person 1 |
| `apps/web/` dan `tests/e2e/` | Person 3 | Person 2 |
| Root workspace config, lockfile, Docker/Compose, `.github/workflows/`, reverse proxy | Person 3 | Person 2 |
| `docs/contracts.md`, `docs/security.md`, deployment manifests | Person 1 | Person 2 |
| `docs/api.md`, `docs/acce.md`, `docs/data-model.md` | Person 2 | Person 1 |
| README, `docs/runbook.md`, `docs/demo.md`, submission evidence index | Person 3 | Person 1 dan Person 2 |

Perubahan dependency disampaikan ke Person 3 untuk menyatukan lockfile. Perubahan shared schema atau ABI disertai contoh payload dan pemberitahuan ke konsumennya; jangan mengganti interface sepihak saat integrasi berlangsung. Secret tidak diserahkan lewat commit atau dokumen.

## 3. Person 1 — Smart Contracts & Blockchain Execution

### Tanggung jawab

1. **Implementasikan kontrak sesuai PRD §13.1.**
   - MockUSDC 6 decimals, faucet rate/supply limits, LiquidVault, TimedVault.
   - Factory dan executor non-upgradeable per owner; owner immutable dan dana antar-owner terisolasi.
   - Owner-only `setMandate`, exact funding, pause/revoke, recovery owner.
   - Batas token/target/action/selector, budget per-action dan kumulatif, expiry, recipient, serta replay protection.
   - Posisi principal 1:1; lockup 30 hari; tidak ada accrual yield fiktif atau arbitrary external call.
2. **Publikasikan interface kontrak lebih awal.** ABI/events/custom errors, fungsi owner/operator, aturan nonce dan budget, serta contoh call yang valid/invalid.
3. **Implementasikan `packages/chain/` dan chain worker.**
   - Registry deployment tepercaya, validasi chain/bytecode/owner, typed reads dan transaction preparation.
   - Operator signing, koordinasi EOA nonce melalui repository Person 2, gas limits dan preflight.
   - Monitor event, snapshot, confirmation policy, cursor/block hashes, deduplication dan reorg handling.
   - Receipt reconciliation, bounded fee replacement, serta pemulihan crash tanpa action ID baru.
4. **Deployment dan bukti publik.** Local deployment script, Base Sepolia manifest, faucet setup, receipt deposit/withdraw dan revert evidence.
5. **Security documentation.** Threat boundaries, remaining delegated-budget risk, admin/operator separation dan revoke/recovery procedure.

### Pengujian wajib

- Owner-only authority changes dan penolakan direct operator calls yang tidak sah.
- Budget, expiry, wrong chain/token/target/selector, beneficiary dan replay.
- Lockup/unlock, expiry lebih pendek dari lockup, partial withdrawal, dan cumulative budget setelah exit.
- Mandate replacement saat posisi belum ditutup; recovery setelah pause/revoke/expiry.
- Fuzz/invariant tests; dua worker berbagi signer; RPC timeout/crash setelah broadcast.
- Duplicate event dan reorg simulation bersama Person 2.

### Definition of done

- [ ] Foundry tests lolos; tidak ada invariant failure terbuka.
- [ ] ABI, manifest, typed adapter dan error codes bisa dipakai Person 2/3.
- [ ] Deposit dan risk-response withdrawal LiquidVault terbukti melalui receipt publik.
- [ ] Operator tidak dapat memperluas authority walaupun verifier backend dilewati.
- [ ] Chain recovery tests lolos dan hasilnya dapat ditelusuri.
- [ ] `docs/contracts.md` dan `docs/security.md` lengkap beserta bukti.

**Dependensi:** shared action/mandate schema dan repository locks/cursors dari Person 2; runtime RPC, gas, serta signer secrets yang tersedia melalui environment.

## 4. Person 2 — Backend, ACCE & Data

### Tanggung jawab

1. **Tetapkan shared contracts aplikasi.** DTO/schema intent, question, preference, mandate, action, policy check, risk event dan receipt. Nominal token selalu string pada API dan exact integer di database.
2. **Bangun PostgreSQL + Prisma.** Migrations, repositories, audit records, unique constraints, session storage, durable jobs/outbox, leases, dan mekanisme locking/nonce reservation yang dipakai Person 1.
3. **Implementasikan wallet authentication dan authorization.** SIWE challenge EOA, nonce sekali pakai, expiry/domain/chain checks, secure session cookie, CSRF, rate limits, owner isolation dan demo-admin access.
4. **Bangun API NestJS.** Intent/session, clarification/answer, mandate draft/preview, activity, balances/positions via chain adapter, faucet request dan admin risk-fixture request. Publish OpenAPI dan contoh respons.
5. **Implementasikan ACCE dan provider adapter.**
   - Deterministic ranking 0–3, decision-flip checks, maksimum 5 pertanyaan, template fallback dan output schema validation.
   - Unknown/conflict handling, conservative draft atau ESCALATE.
   - Kandidat dan eligibility berasal dari trusted descriptors, bukan alamat/rate output LLM.
6. **Bangun agent orchestration.**
   - State machine, eligibility/action selection, deterministic verifier dan explanation summary.
   - Gate funding + confirmed authorization, satu alokasi, serta HOLD/ESCALATE yang jelas.
   - Panggil typed execution service Person 1; jangan membuat signer atau transaction sender kedua.
   - Revalidasi mandate version/snapshot sebelum dispatch; stop/escalate tanpa memperluas permission.
7. **Bangun runner benchmark B0–B3.** Integrasikan fixture Person 3 tanpa membocorkan hidden labels ke policy generator; rekam draft-vs-approved mismatch, completion, refusal, cost/latency dan denominator.
8. **Dokumentasikan API, ACCE dan data model.** Siapkan backend/worker env validation serta health/readiness dan metrics yang dibutuhkan deployment.

### Pengujian wajib

- Replay login nonce, akses lintas owner, CSRF dan unauthorized admin endpoints.
- ACCE memilih pertanyaan relevan, berhenti tepat, serta menangani UNKNOWN/kontradiksi/LLM gagal.
- Mandate preview konsisten dengan batas kontrak; tidak aktif hanya dari status database.
- Atomic enqueue, duplicate action, dua worker claim job, lease expiry dan restart recovery pada PostgreSQL nyata.
- Action ordering, expiry-lockup eligibility, repeated deposit prevention dan partial risk exit bersama Person 1.
- Benchmark deterministik, held-out isolation dan perhitungan metrik.

### Definition of done

- [ ] OpenAPI dan shared schemas stabil serta dipakai frontend/worker.
- [ ] API + worker + PostgreSQL berjalan tanpa in-memory state sebagai sumber persisten.
- [ ] Auth, ACCE, verifier, workflow dan concurrency tests lolos.
- [ ] LLM provider nyata terintegrasi; fallback diberi label dan tidak diklaim sebagai AI run.
- [ ] Benchmark 50 persona tersedia, dengan 20 development dan 30 held-out.
- [ ] Hasil evaluasi menyertakan kegagalan dan tidak mengklaim improvement yang belum terbukti.

**Dependensi:** ABI/chain adapter Person 1; fixture independen dan UI/API consumer Person 3; API key LLM runtime untuk run nyata.

## 5. Person 3 — Frontend, Delivery & Demo QA

### Tanggung jawab

1. **Scaffold workspace bersama.** Root pnpm config, scripts, lint/typecheck, test entry points, CI dan dependency lockfile. Koordinasikan package boundaries sebelum Person 1/2 mulai menambah modul.
2. **Bangun Next.js UI berbahasa Inggris.**
   - Wallet connect, network guard, login, saldo/funding readiness dan faucet.
   - Intent form, satu pertanyaan ACCE per langkah, opsi unsure, dan perubahan eligibility vault.
   - Mandate preview dengan target/budget/expiry dan perbedaan constraint yang jelas.
   - Owner transactions melalui wagmi/viem: create executor, set mandate, exact approval, funding, pause/revoke dan owner recovery.
   - Dashboard balances/positions, risk status, activity timeline, rejection reasons dan explorer links.
   - Loading/empty/pending/degraded/error/recovery states, layout responsif dan keyboard navigation.
3. **Implementasikan delivery.** Dockerfiles/build wiring, Compose web/API/worker/PostgreSQL, reverse proxy satu origin, HTTPS, env templates dan release workflow. Gunakan health/lifecycle hooks dari Person 1/2.
4. **Operasi dan runbook.** Runtime secret injection, persistent volumes, backup schedule/restore drill, health/heartbeat dashboards, alert routing dan rollback/recovery instructions. Person 1/2 memasok prosedur pemulihan modulnya.
5. **Koordinasikan browser E2E dan demo rehearsal.** Uji happy path serta wallet rejection, wrong network, expired/revoked mandate, provider failure dan admin risk response. Laporkan bug ke owner modulnya.
6. **Siapkan fixture evaluasi secara independen.** Tulis 50 persona/labels sebelum held-out run, termasuk konflik, irrelevant uncertainty, safe no-trade dan misleading descriptions. Person 1 mereview label; hidden labels tidak disalin ke prompt implementasi Person 2.
7. **Kemasan submission.** Evidence index, README, demo script lima menit, deck, backup video dan benchmark dashboard/report dari hasil asli.

### Pengujian wajib

- Login → intent → ACCE → review → authorization → funding → deposit → risk response → revoke.
- Setiap owner transaction menangani pending/rejected/reverted tanpa status sukses palsu.
- Data testnet/yield ilustratif terlihat jelas; HOLD/pre-broadcast denial tidak diberi tx hash palsu.
- Production builds dan clean setup Compose dapat diulang dari README.
- Restore database ke instance terpisah, health recovery, UI degradation dan soak test minimal 60 menit bersama Person 1/2.
- Browser walkthrough dengan dua persona yang memiliki prompt sama tetapi preferensi berbeda.

### Definition of done

- [ ] Semua layar utama terhubung API/chain nyata, bukan hanya mock UI.
- [ ] CI, production builds dan E2E hijau; deployment HTTPS dapat digunakan tim.
- [ ] Backup/restore drill, monitoring, runbook dan release identifiers tersedia.
- [ ] Manifest fixture dan hasil benchmark berlabel jelas; held-out tidak dipakai untuk tuning ulang.
- [ ] Demo direhearsal dengan receipt publik, blocked attempt, hasil evaluasi dan limitations.
- [ ] README, evidence index, deck dan backup video siap submission.

**Dependensi:** OpenAPI/shared schemas Person 2; ABI/manifests Person 1; domain/hosting dan runtime secrets untuk deployment publik.

## 6. Handoff pertama — kerjakan sebelum implementasi paralel penuh

Target sesi awal adalah interface yang cukup stabil untuk ketiganya bekerja tanpa menunggu seluruh modul selesai.

| Handoff | Pengirim → penerima | Isi minimum |
| --- | --- | --- |
| Workspace scaffold | Person 3 → Person 1/2 | Struktur folder, package scripts, env template, PostgreSQL lokal, CI skeleton |
| Contract interface v1 | Person 1 → Person 2/3 | Fungsi, structs, events, errors, owner/operator distinction, contoh deployment lokal |
| Shared schema v1 | Person 2 → Person 1/3 | Exact amount format, mandate/action types, state machine dan stable error codes |
| API mock contract | Person 2 → Person 3 | OpenAPI/payload examples; UI dapat mulai dengan mock adapter yang dapat diganti real API |
| Execution port | Person 1 ↔ Person 2 | Interface inspect/simulate/submit/reconcile; Person 1 owns chain effects, Person 2 owns workflow/jobs |
| Database ports | Person 2 → Person 1 | Atomic job claim, action lookup, tx attempts, signer nonce reservation, event/cursor persistence |
| Evaluation manifest | Person 3 → Person 1 untuk review | Expected labels, 20/30 split, fixture version; held-out labels tidak tersedia bagi pembuat prompt |

**Aturan integrasi:** frontend tidak menandai mandat aktif hanya karena `setMandate` dikirim; backend/chain adapter memverifikasi receipt, versi dan funding. Tidak ada endpoint yang menerima alamat/selector arbitrer untuk dieksekusi operator.

## 7. Milestone bersama

Urutan gate lebih penting daripada tanggal. Jadwal mengikuti target proposal; jika gate tertinggal, tampilkan status sebenarnya dan prioritaskan jalur kritis.

| Target | Person 1 | Person 2 | Person 3 | Gate integrasi |
| --- | --- | --- | --- | --- |
| Awal / 15 Okt | Interface + kontrak lokal dan negative tests | Schema, migrations, auth/API skeleton, ACCE dasar | Workspace/CI, UI flow, Compose dasar, fixture draft | Interfaces v1 disepakati |
| 16 Okt | Deploy Base Sepolia dan buktikan restricted deposit | Wire jobs/verifier ke execution adapter | Wallet/mandate/funding UI dan receipt display | Minimal satu deposit agent publik; developer harness boleh jika UI belum lengkap |
| 17 Okt | Monitor/receipt integration dan recovery awal | Intent → ACCE → authorization workflow | Full UI/API integration | Satu browser journey lengkap sampai deposit |
| 18 Okt | Risk withdrawal, replay, compromised-operator tests | Risk decisions, retries/concurrency, benchmark runner | E2E, frozen held-out fixtures, monitoring | Risk exit/escalation + blocked attempt + benchmark run |
| 19 Okt | Final security evidence, deployment docs | Freeze config, evaluasi final, backend docs | Deployment QA, restore/soak drill, deck/video | CI hijau, release gates dan rehearsal selesai |
| 20 Okt | Verifikasi hashes/manifests | Verifikasi results/denominators | Final evidence index dan submission package | QA akhir; tidak ada perluasan fitur |

Deadline kompetisi dalam proposal belum diverifikasi ke penyelenggara; Person 3 mengecek batas resmi dan kebutuhan submission sebelum hari terakhir. Jadwal tidak membuktikan bahwa suatu deliverable sudah selesai.

## 8. Review silang dan tanggung jawab release

| Area | Implementer | Reviewer wajib | Bukti |
| --- | --- | --- | --- |
| Authority, signer dan fund movement | Person 1 | Person 2 | Foundry/invariant results, public receipts, direct-call denial |
| Auth, verifier, jobs dan data isolation | Person 2 | Person 1 | API/PostgreSQL integration tests dan concurrency results |
| Owner transaction UX dan preview | Person 3 | Person 1 + Person 2 | Payload sesuai schema/ABI; E2E |
| CI/deployment/recovery | Person 3 | Person 2; Person 1 untuk chain recovery | Build logs, health, restore drill, reconciliation evidence |
| Hidden labels dan evaluator | Person 3 | Person 1 | Frozen manifest dan labeled expectations |
| ACCE/baseline runner dan metrik | Person 2 | Person 3 | Reproducible run, denominator, failure cases |

Person 3 mengoordinasikan release checklist, tetapi Person 1 harus menyatakan gate kontrak/chain lolos dan Person 2 menyatakan gate backend/AI/data lolos. Temuan kritis pada authority, signing, auth atau value movement memblokir release sampai diperbaiki atau jalur terdampak dinonaktifkan dengan jelas.

## 9. Aturan scope dan prioritas

- Urutan kerja: **authority + transaksi benar → alur lengkap → risk/recovery → bukti evaluasi → polish dan rehearsal**. UI dapat dibangun paralel memakai interface awal.
- Jangan menambah mainnet, live DeFi, bridge, trading, account abstraction, mobile, split allocation, atau accrual yield nyata.
- AI tidak memegang owner key dan tidak memutuskan permission baru. Tidak ada eksekusi free text.
- Semua evidence menggunakan hasil aktual. Local time travel tidak dipresentasikan sebagai unlock 30 hari yang terjadi pada public testnet.
- Jika terlambat, sederhanakan visual sekunder, animasi, dan tampilan dashboard evaluasi; pertahankan report hasil evaluasi. Jangan menghapus budget enforcement, owner control, replay protection atau reconciliation.
- Blocker dicatat dengan owner, dependensi, dan langkah berikutnya. Perubahan scope atau interface penting diperbarui di PRD dan dokumen ini agar ketiga orang bekerja dengan acuan yang sama.

## 10. Checklist selesai tim

- [ ] Satu clean checkout dapat dijalankan dari README dengan PostgreSQL.
- [ ] Ketiga orang dapat menunjukkan alur produk utuh, bukan hanya modul masing-masing.
- [ ] Kontrak, backend, frontend dan worker memakai versi schema/ABI/config yang cocok.
- [ ] Deposit agent dan risk response memiliki evidence publik; unauthorized attempt ditolak.
- [ ] Pause/revoke/recovery, crash retry, duplicate event dan concurrent workers sudah diuji.
- [ ] Benchmark B0–B3, 50 persona dan limitations tersedia tanpa fabricated claims.
- [ ] Auth/isolation, secrets, CI, HTTPS, health, metrics, restore drill dan runbook diverifikasi.
- [ ] Soak test, demo rehearsal, backup video, deck dan submission evidence index selesai.
- [ ] Seluruh Definition of Done di PRD diperiksa; kekurangan dilaporkan secara eksplisit.
