.DEFAULT_GOAL := help
.PHONY: help app-reinstall

## —— Time Well Spent ————————————————————————————————————————————————
help: ## Show available commands
	@grep -E '^[a-zA-Z0-9_/-]+:.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}{printf "\033[32m%-24s\033[0m %s\n", $$1, $$2}'

app-reinstall: ## Rebuild and restart the app container (run from the server app directory)
	docker compose up -d --build --force-recreate
