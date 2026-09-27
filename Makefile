# Shortcuts for the everyday commands; everything runs through npm.

.DEFAULT_GOAL := help
.PHONY: help install build check test lint typecheck demo site samples check-samples check-browser clean release-patch release-minor

help: ## Show this help
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | sed 's/:.*## /|/' | column -t -s '|'

install: ## Install dependencies
	npm ci

build: ## Compile to dist/
	npm run build

check: typecheck lint test ## Typecheck, lint and tests

test: ## Vitest
	npm test

lint: ## ESLint
	npm run lint

typecheck: ## tsc
	npm run typecheck

demo: ## Build and serve the demo page
	npm run demo

site: ## Build and serve the showcase site
	npm run site

samples: ## Rebuild the sample set from VSCO-2 CE (needs ffmpeg and the cache)
	npm run build:samples

check-samples: ## Verify the shipped samples against the manifest
	npm run check:samples

check-browser: ## Play the demo in headless Chromium
	npm run check:browser

clean: ## Remove build output
	rm -rf dist

release-patch: ## Bump the patch version, tag it and push - CI publishes to npm
	npm version patch && git push --follow-tags

release-minor: ## Bump the minor version, tag it and push - CI publishes to npm
	npm version minor && git push --follow-tags
