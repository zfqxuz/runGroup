FROM node:22-slim
ENV DSH_HOME=/dsh-home
RUN npm i -g @deepseek-ai/dsh@0.1.5-rc.1

# profile / 软链接单独一层：改这块不会触发上面 npm install 重跑。
RUN mkdir -p /dsh-home/profiles/headless \
 && printf '{\n  "name": "dsh-profile-headless",\n  "private": true,\n  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"], "patchReload": "startup" } }\n}\n' > /dsh-home/profiles/headless/package.json \
 && printf '[]\n' > /dsh-home/profiles/headless/cordis.yml \
 && printf '[]\n' > /dsh-home/profiles/headless/cordis.patch.yml \
 && mkdir -p /dsh-home/profiles/node_modules \
 && for entry in /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/*; do case "$(basename "$entry")" in @*) mkdir -p "/dsh-home/profiles/node_modules/$(basename "$entry")"; for child in "$entry"/*; do ln -sfn "$child" "/dsh-home/profiles/node_modules/$(basename "$entry")/$(basename "$child")"; done ;; *) ln -sfn "$entry" "/dsh-home/profiles/node_modules/$(basename "$entry")" ;; esac; done \
 && printf 'agent-default-model:\n  provider: deepseek-official\n  model: deepseek-flash\n' > /dsh-home/settings.yaml
WORKDIR /app
COPY server.mjs /app/server.mjs
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8790/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "/app/server.mjs"]
