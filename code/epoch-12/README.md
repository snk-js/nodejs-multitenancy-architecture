# Snapshot — Epoch 12: The Capstone Architecture

Epoch 12 adds **no new code by design**: it is the guided tour of the finished system.
The final snapshot is [`code/epoch-11`](../epoch-11) — that directory *is* the
capstone architecture described in
[`epochs/epoch-12-capstone.md`](../../epochs/epoch-12-capstone.md).

Two exercises worth doing here:

```bash
# 1. The whole course as one diff — every line has a reason you can now recite:
diff -ru ../epoch-00 ../epoch-11 | less

# 2. The epoch-by-epoch archaeology — watch each pain get its cure:
for i in 00 01 02 03 04 05 06 07 08 09 10; do
  next=$(printf "%02d" $((10#$i + 1)))
  echo "=== epoch-$i → epoch-$next ==="
  diff -rq ../epoch-$i ../epoch-$next | grep -v node_modules
done
```

Then take the capstone's exit exam (§12.6). No answers provided — that's the point.
