# --- Stage 1: Install dependencies ---
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# --- Stage 2: Build ---
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build Next.js (standalone output)
RUN npm run build

# --- Stage 3: Production runner ---
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Install XeLaTeX + CJK support for PDF generation
RUN apk add --no-cache \
    texlive-xetex \
    texmf-dist-latexextra \
    texmf-dist-pictures \
    texmf-dist-langchinese \
    texmf-dist-langcjk \
    texmf-dist-plaingeneric \
    texmf-dist-fontsrecommended \
    && mkdir -p /usr/share/fonts/custom

# Copy custom fonts (標楷體)
COPY fonts/kaiu.ttf /usr/share/fonts/custom/
RUN fc-cache -fv

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy Prisma generated client (Prisma 7 — output in src/generated)
COPY --from=builder /app/src/generated ./src/generated
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Copy LaTeX template + stamps for PDF generation
COPY templates/ ./templates/
COPY stamps/ ./stamps/

# Ensure output dir is writable
RUN mkdir -p /app/generated_invoices_latex && chown nextjs:nodejs /app/generated_invoices_latex

USER nextjs

# XeLaTeX env vars for Cloud Run
ENV XELATEX_PATH=/usr/bin/xelatex
ENV STAMP_DIR=/app/stamps
ENV FONT_DIR=/usr/share/fonts/custom/

EXPOSE 8080

CMD ["node", "server.js"]
