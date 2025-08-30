#!/bin/bash

# Add @ts-nocheck to all ANTLR generated files
for file in antlr/*.ts; do
  if [ -f "$file" ]; then
    # If the first line is not @ts-nocheck, add it
    if ! head -n 1 "$file" | grep -q "@ts-nocheck"; then
      # Create a temporary file
      temp_file=$(mktemp)

      # Add @ts-nocheck to the first line
      echo "// @ts-nocheck" > "$temp_file"
      cat "$file" >> "$temp_file"

      # Replace the original file
      mv "$temp_file" "$file"
      
      echo "Added @ts-nocheck to $file"
    else
      echo "@ts-nocheck already exists in $file"
    fi
  fi
done
