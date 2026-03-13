PYTHON := python3

.PHONY: bootstrap bootstrap-python bootstrap-node lint lint-python lint-node typecheck typecheck-python format-check format-check-node format format-node test test-python test-node test-contracts build-user-portal pilot-gate pilot-evidence pilot-source-health

bootstrap: bootstrap-python bootstrap-node

bootstrap-python:
	cd services/lead-engine && poetry install
	cd services/obituary-intelligence-engine && poetry install

bootstrap-node:
	cd services/crm-adapter && npm ci
	cd services/user-portal && npm ci

lint: lint-python lint-node

lint-python:
	cd services/lead-engine && poetry run ruff check src tests
	cd services/obituary-intelligence-engine && poetry run ruff check src tests

lint-node:
	cd services/crm-adapter && npm run lint
	cd services/user-portal && npm run lint

typecheck: typecheck-python

typecheck-python:
	cd services/lead-engine && poetry run mypy src
	cd services/obituary-intelligence-engine && poetry run mypy src

format-check: format-check-node

format-check-node:
	cd services/crm-adapter && npm run format:check
	cd services/user-portal && npm run format:check

format: format-node

format-node:
	cd services/crm-adapter && npm run format
	cd services/user-portal && npm run format

test: test-contracts test-python test-node

test-python:
	cd services/lead-engine && poetry run pytest
	cd services/obituary-intelligence-engine && poetry run pytest

test-node:
	cd services/crm-adapter && npm test
	cd services/user-portal && npm test

test-contracts:
	$(PYTHON) scripts/check-contracts.py

build-user-portal:
	cd services/user-portal && npm run build

pilot-gate:
	bash scripts/pilot-readiness-check.sh

pilot-evidence:
	bash scripts/capture-pilot-evidence.sh

pilot-source-health:
	$(PYTHON) scripts/validate-obituary-sources.py --json-output /tmp/obituary-sources.json
