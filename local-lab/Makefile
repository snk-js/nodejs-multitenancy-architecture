# The lab control panel. Companion to deep-dives/06-running-it-all-locally.md
#
# Philosophy: you can't rent 100 servers to learn what breaks at scale, but you
# CAN shrink the limits until they break on a laptop. Every target below either
# builds the environment or induces a specific failure from the course.

COMPOSE := docker compose
DB      := $(COMPOSE) exec -T db psql -U trellis -d trellis
TOXI    := http://localhost:8474
BASE    := http://localhost:8080
ACME    := acme.localtest.me:8080
GLOBEX  := globex.localtest.me:8080

.DEFAULT_GOAL := help
.PHONY: help up down reset logs migrate seed smoke traces mail \
        explain pool-exhaustion noisy-neighbor chaos-latency chaos-drop chaos-clear \
        db-down db-up drain-drill rls-check experiments

help: ## show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

## ---------------------------------------------------------------- lifecycle

up: ## start the whole lab (2 api replicas, worker, db, redis, toxiproxy, jaeger, mailpit)
	$(COMPOSE) up -d --build db redis toxiproxy jaeger mailpit
	$(COMPOSE) run --rm migrate
	$(COMPOSE) up -d --build api worker proxy
	@echo
	@echo "  app      → http://$(ACME)/health/ready   (and http://$(GLOBEX)/…)"
	@echo "  traces   → http://localhost:16686"
	@echo "  mail     → http://localhost:8025"
	@echo "  toxiproxy→ $(TOXI)"
	@echo
	@echo "  next: make seed"

down: ## stop everything (keeps the database volume)
	$(COMPOSE) down

reset: ## stop everything AND delete the database volume
	$(COMPOSE) down -v

logs: ## tail all logs
	$(COMPOSE) logs -f --tail=100

migrate: ## apply migrations (as the OWNER role — Epoch 07's privilege split)
	$(COMPOSE) run --rm migrate

seed: ## load skewed realistic data (~1M tasks: whale / mid / minnow)
	$(DB) -v ON_ERROR_STOP=1 -f - < seed.sql

smoke: ## prove the stack is alive end to end
	@curl -sf $(BASE)/health/live  && echo "  ← liveness"
	@curl -sf $(BASE)/health/ready && echo "  ← readiness"

traces: ## open the trace UI
	@echo "http://localhost:16686"

mail: ## open the fake inbox (invite emails land here)
	@echo "http://localhost:8025"

## ------------------------------------------------------- experiment catalogue

experiments: ## list the lab manual
	@echo "  make rls-check        Epoch 07 — an UNSCOPED query stays scoped anyway"
	@echo "  make explain          Epoch 03 — index vs seq scan on ~1M rows"
	@echo "  make pool-exhaustion  Epoch 03/08 — slow queries pin the pool; others starve"
	@echo "  make noisy-neighbor   Epoch 07/08 — one tenant degrades another, then doesn't"
	@echo "  make chaos-latency    Epoch 08 — +500ms on every DB call"
	@echo "  make chaos-drop       Epoch 08 — 30% of DB connections die"
	@echo "  make chaos-clear      remove all injected faults"
	@echo "  make db-down / db-up  Epoch 08 — liveness stays up, readiness goes 503"
	@echo "  make drain-drill      Epoch 08 — SIGTERM mid-request drops nothing"

rls-check: ## the leak that isn't: unscoped SELECT, still scoped by the database
	@echo "--- no tenant context: expect 0 rows (fails SAFE, not open) ---"
	@$(DB) -c "SELECT count(*) AS unscoped FROM tasks;"
	@echo "--- stamped as acme: expect ~900k ---"
	@$(DB) -c "BEGIN; SELECT set_config('app.tenant_id','00000000-0000-4000-b000-000000000001',true); SELECT count(*) AS acme FROM tasks; COMMIT;"

explain: ## watch the tenant-leading index earn its keep
	@echo "--- WITH the (workspace_id, created_at) index ---"
	@$(DB) -c "BEGIN; SELECT set_config('app.tenant_id','00000000-0000-4000-b000-000000000001',true); \
	  EXPLAIN (ANALYZE, BUFFERS) SELECT id,title,done,created_at FROM tasks \
	  WHERE workspace_id='00000000-0000-4000-b000-000000000001' ORDER BY created_at DESC LIMIT 50; COMMIT;"
	@echo
	@echo "now: DROP INDEX tasks_workspace_id_created_at_index; and run again."
	@echo "Seq Scan + Sort over ~1M rows is the lesson. Then recreate it."

pool-exhaustion: ## hold every connection with slow queries and watch the rest starve
	@echo "firing 20 concurrent 10s queries against a pool of 10…"
	@for i in $$(seq 1 20); do $(DB) -c "SELECT pg_sleep(10);" >/dev/null 2>&1 & done; \
	sleep 2; \
	echo "meanwhile, a normal request:"; \
	time curl -s -o /dev/null -w "  health/ready → %{http_code} in %{time_total}s\n" $(BASE)/health/ready; \
	wait

noisy-neighbor: ## one tenant hammers the API; measure the other tenant's latency
	@command -v autocannon >/dev/null || { echo "npx autocannon will be used"; }
	@echo "baseline (quiet system):"
	@curl -s -o /dev/null -w "  acme p50-ish → %{time_total}s\n" http://$(ACME)/health/ready
	@echo "now hammering globex for 15s…"
	@npx -y autocannon -c 100 -d 15 http://$(GLOBEX)/health/ready >/dev/null 2>&1 & \
	sleep 5; \
	curl -s -o /dev/null -w "  acme under load → %{time_total}s\n" http://$(ACME)/health/ready; \
	wait
	@echo "→ now enable the per-tenant limiter (Epoch 07 §7.7) and repeat."

chaos-latency: ## +500ms on every database call (Toxiproxy)
	@curl -s -X POST $(TOXI)/proxies/postgres/toxics \
	  -d '{"name":"lat","type":"latency","attributes":{"latency":500,"jitter":100}}' \
	  -H 'content-type: application/json' | head -c 200; echo
	@echo "→ watch timeouts, traces, and /health/ready react. make chaos-clear to stop."

chaos-drop: ## kill 30% of database connections
	@curl -s -X POST $(TOXI)/proxies/postgres/toxics \
	  -d '{"name":"cut","type":"timeout","toxicity":0.3,"attributes":{"timeout":1}}' \
	  -H 'content-type: application/json' | head -c 200; echo

chaos-clear: ## remove all injected faults
	@for t in lat cut; do curl -s -X DELETE $(TOXI)/proxies/postgres/toxics/$$t >/dev/null; done
	@echo "faults cleared"

db-down: ## kill the database — liveness must stay 200, readiness must go 503
	$(COMPOSE) stop db
	@sleep 2
	@curl -s -o /dev/null -w "  /health/live  → %{http_code}  (expect 200)\n" $(BASE)/health/live
	@curl -s -o /dev/null -w "  /health/ready → %{http_code}  (expect 503)\n" $(BASE)/health/ready

db-up: ## bring the database back — recovery without restarting the app
	$(COMPOSE) start db
	@sleep 3
	@curl -s -o /dev/null -w "  /health/ready → %{http_code}  (expect 200)\n" $(BASE)/health/ready

drain-drill: ## SIGTERM one replica mid-traffic; a correct drain drops nothing
	@echo "sending continuous traffic while one replica is terminated…"
	@( for i in $$(seq 1 200); do \
	     curl -s -o /dev/null -w "%{http_code}\n" $(BASE)/health/ready; sleep 0.05; \
	   done > /tmp/drain-drill.txt ) & \
	sleep 2; \
	$(COMPOSE) kill -s SIGTERM api || true; \
	wait; \
	echo "  non-200 responses: $$(grep -vc 200 /tmp/drain-drill.txt || true) (expect 0)"
