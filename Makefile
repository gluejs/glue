PACKAGE_NAME = glue

# Tools

YARN   ?= yarn
CHGLOG ?= git-chglog

# Variables

ARGS    ?=
TARGET  ?= ES5
DATE    ?= $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")
VERSION ?= $(shell git describe --tags --always --dirty --match=v* 2>/dev/null | sed 's/^v//' || \
			cat $(CURDIR)/.version 2> /dev/null || echo 0.0.0-unreleased)

# Build

.PHONY: all
all: vendor | glue docs

.PHONY: glue
glue: vendor ; $(info building $@ ...) @
	BUILD_VERSION=$(VERSION) BUILD_DATE=$(DATE) TARGET=$(TARGET) $(YARN) webpack --display-error-details --color --mode=production
	echo $(VERSION) > .version

.PHONY: glue-es5
glue-es5: TARGET=ES5
glue-es5: glue

.PHONY: glue-es6
glue-es6: TARGET=ES2015
glue-es6: glue

.PHONY: glue-dev
glue-dev: vendor ; $(info building and watching $@ ...) @
	TARGET=$(TARGET) $(YARN) webpack --display-error-details --progress --color --mode=development --watch

.PHONY: docs
docs: vendor ; $(info building $@ ...) @
	@$(YARN) typedoc --out ./docs --hideGenerator --excludePrivate --name 'Glue Javascript Library $(VERSION)' --mode file --theme minimal --target ES5 ./src

# Helpers

.PHONY: lint
lint: vendor ; $(info running linters ...) @
	@$(YARN) eslint . --ext .js,.ts --cache && echo "eslint: no lint errors"

.PHONY: lint-checkstyle
lint-checkstyle: vendor ; $(info running linters checkstyle ...) @
	@mkdir -p ./test
	@$(YARN) eslint -f checkstyle --ext .js,.ts -o ./test/tests.eslint.xml . || true

# Yarn

.PHONY: vendor
vendor: .yarninstall

.yarninstall: package.json ; $(info getting depdencies with yarn ...)   @
	@$(YARN) install
	@touch $@

.PHONY: dist
dist: ; $(info building dist tarball ...)
	@mkdir -p "dist/"
	$(YARN) pack --filename="dist/${PACKAGE_NAME}-${VERSION}.tgz"

.PHONY: changelog
changelog: ; $(info updating changelog ...)
	$(CHGLOG) --output CHANGELOG.md $(ARGS)

.PHONY: clean
clean: ; $(info cleaning ...) @
	$(YARN) cache clean
	@rm -rf umd
	@rm -f NOTICES.txt
	@rm -f .version
	@rm -rf node_modules
	@rm -f .yarninstall

.PHONY: version
version:
	@echo $(VERSION)
