#!/usr/bin/env bash
P="red%20apple%20on%20white%20background"
for q in "width=512&height=512&seed=1&model=flux&nologo=true&safe=true" "width=512&height=512&seed=1&model=flux" "width=512&height=512&seed=2" ""; do
  for ref in "" "https://carlosandre1514-prog.github.io/"; do
    code=$(curl -s -m 90 -o /tmp/p.img -w "%{http_code} %{content_type} %{size_download}" ${ref:+-H "Referer: $ref"} -H "Origin: https://carlosandre1514-prog.github.io" "https://image.pollinations.ai/prompt/$P?$q")
    echo "q=[$q] ref=[$ref] -> $code"
  done
done
curl -s -m 30 -D - -o /dev/null -H "Origin: https://carlosandre1514-prog.github.io" "https://image.pollinations.ai/prompt/$P?width=512&height=512&seed=3" | grep -i "access-control\|HTTP/"
head -c 300 /tmp/p.img | strings | head -5
