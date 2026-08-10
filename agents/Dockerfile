FROM node:22-bookworm-slim AS node-runtime
WORKDIR /agent
COPY agents/runtime/run.mjs /agent/run.mjs
COPY agents/runtime/wordlists /agent/wordlists

FROM node-runtime AS orchestrator

FROM node-runtime AS reporter

FROM node-runtime AS source-review

FROM node-runtime AS port-scanner
RUN apt-get update \
    && apt-get install -y --no-install-recommends nmap ca-certificates \
    && rm -rf /var/lib/apt/lists/*

FROM golang:1.25-bookworm AS gobuster-build
RUN GOBIN=/out go install github.com/OJ/gobuster/v3@v3.8.2

FROM node-runtime AS directory-enumerator
COPY --from=gobuster-build /out/gobuster /usr/local/bin/gobuster

FROM directory-enumerator AS subdomain-enumerator

FROM mcr.microsoft.com/playwright:v1.55.0-noble AS browser-user
WORKDIR /agent
COPY agents/runtime/run.mjs /agent/run.mjs
RUN npm install --prefix /agent --omit=dev playwright@1.55.0

FROM browser-user AS explorer

FROM semgrep/semgrep:1.133.0 AS semgrep
ENTRYPOINT []
COPY agents/runtime/scan.py /agent/scan.py
COPY agents/runtime/semgrep-rules.yml /agent/semgrep-rules.yml

FROM trufflesecurity/trufflehog:3.90.5 AS trufflehog-bin

FROM ubuntu:24.04 AS freeform-ubuntu
RUN DEBIAN_FRONTEND=noninteractive apt-get update \
    && apt-get install -y --no-install-recommends \
      bash ca-certificates curl dnsutils file git iproute2 iputils-ping jq \
      netcat-openbsd nmap openssl python3 ripgrep unzip wget \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
COPY agents/freeform-ubuntu/freeform.py /agent/freeform.py
RUN chmod 0555 /agent/freeform.py

FROM python:3.12-slim AS trufflehog
COPY --from=trufflehog-bin /usr/bin/trufflehog /usr/local/bin/trufflehog
COPY agents/runtime/scan.py /agent/scan.py

FROM eclipse-temurin:21-jre-noble AS burp-suite
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY agents/burp-suite/start-burp /opt/hiveswarm/start-burp
RUN chmod 0755 /opt/hiveswarm/start-burp
VOLUME ["/opt/burp"]
