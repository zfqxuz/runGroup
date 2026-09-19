FROM node:22-slim
ENV DSH_HOME=/dsh-home
RUN npm i -g @deepseek-ai/dsh@0.1.5-rc.1 \
 && mkdir -p /dsh-home/profiles/headless \
 && printf '{\n  "name": "dsh-profile-headless",\n  "private": true,\n  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"], "patchReload": "startup" } }\n}\n' > /dsh-home/profiles/headless/package.json \
 && printf '[]\n' > /dsh-home/profiles/headless/cordis.yml \
 && printf '[]\n' > /dsh-home/profiles/headless/cordis.patch.yml \
 && ln -s /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules /dsh-home/profiles/node_modules \
 && printf 'agent-default-model:\n  provider: deepseek-official\n  model: deepseek-flash\n' > /dsh-home/settings.yaml
WORKDIR /app
COPY server.mjs /app/server.mjs
EXPOSE 8790
CMD ["node", "/app/server.mjs"]
