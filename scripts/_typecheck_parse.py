#!/usr/bin/env python3
"""Parse tsc output from stdin. Args: summary_mode threshold"""
import sys, re, collections

summary_mode = len(sys.argv) > 1 and sys.argv[1] == 'True'
threshold = int(sys.argv[2]) if len(sys.argv) > 2 else 0

tsc = sys.stdin.read()
errs = []
for l in tsc.split('\n'):
    m = re.match(r'^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)', l.strip())
    if m:
        errs.append({'file': m.group(1), 'code': m.group(4), 'msg': m.group(5)})

total = len(errs)

if total == 0:
    print("✅  0 TypeScript errors — clean build\n")
    sys.exit(0)

print(f"❌  {total} TypeScript errors\n")

if summary_mode:
    print("── By error code ────────────────────────────────")
    by_code = collections.Counter(e['code'] for e in errs)
    for code, count in by_code.most_common(15):
        sample = next(e['msg'] for e in errs if e['code'] == code)[:45]
        print(f"  {count:5d}  {code:10s}  {sample}")
    print("")
    print("── By file (top 15) ─────────────────────────────")
    by_file = collections.Counter(e['file'] for e in errs)
    for f, count in by_file.most_common(15):
        fname = f.split('/')[-1]
        print(f"  {count:4d}  {fname}")
    print("")

BLOCKING = {'TS17001','TS17002','TS17008','TS17015','TS1003','TS1005','TS1128','TS1108','TS1109','TS2657'}
structural = [e for e in errs if e['code'] in BLOCKING]
print(f"── Structural (blocking): {len(structural)}")
for e in structural[:10]:
    fname = e['file'].split('/')[-1]
    print(f"   {fname}: {e['code']}: {e['msg'][:60]}")

if not structural:
    print("   ✅ None — JSX structure is clean")

if threshold > 0 and total <= threshold:
    print(f"\n⚠️  {total} ≤ threshold ({threshold}) — passing")
    sys.exit(0)

sys.exit(1 if structural else 0)
