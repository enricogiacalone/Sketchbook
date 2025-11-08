
#!/bin/bash

# Get the root directory of the project
PROJECT_ROOT="/Users/egiacalone/Downloads/TODO/Sketchbook"

# Find all .ts files in the src/ts directory
FILES=$(find "$PROJECT_ROOT/src/ts" -type f -name "*.ts")

# Initialize an array to store files with relative imports
FILES_WITH_RELATIVE_IMPORTS=()

# Iterate over each file
for FILE_PATH in $FILES; do
    # Search for relative import patterns (e.g., from "../")
    # The -E option enables extended regular expressions
    # The -q option suppresses normal output
    if grep -Eq 'from\s+"?\.\./' "$FILE_PATH"; then
        FILES_WITH_RELATIVE_IMPORTS+=("$FILE_PATH")
    fi
done

# Print the list of files with relative imports
if [ ${#FILES_WITH_RELATIVE_IMPORTS[@]} -eq 0 ]; then
    echo "No relative imports found in src/ts directory."
else
    echo "Files with relative imports in src/ts directory:"
    for FILE_WITH_RELATIVE_IMPORT in "${FILES_WITH_RELATIVE_IMPORTS[@]}"; do
        echo "- $FILE_WITH_RELATIVE_IMPORT"
    done
fi
