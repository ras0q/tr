Output docs/demo.gif

Require node
Require npm
Set Shell bash
Set Width 900
Set Height 550

# A fresh project keeps the recording independent of this repository.
Hide
Type@1ms `demo_dir=$(mktemp -d); trap 'rm -rf "$demo_dir"' EXIT; cd "$demo_dir"; printf '{\n  "private": true,\n"description": "Instll CLI tools with npm"}\n' > package.json; npm config set audit false; clear`
Enter
Sleep 500ms
Show
Sleep 1s

Type "# tr: Your CLI tools, managed with npm"
Enter
Sleep 500ms
Type "npm config set @tr:registry https://tr.ras0q.com"
Enter
Sleep 500ms
Wait+Line@30s /^\> ?$/
Enter
Sleep 1s

Type "# Add a CLI tool from GitHub releases"
Enter
Sleep 500ms
Type "npm install -D @tr/crate-ci--typos"
Enter
Sleep 500ms
Wait+Line@120s /^\> ?$/
Enter
Sleep 1s

Type "# Now you can run `typos` with npx"
Enter
Sleep 500ms
Type "npx typos ."
Enter
Sleep 500ms
Wait+Line@120s /^\> ?$/
Sleep 4s
