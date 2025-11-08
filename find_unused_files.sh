
#!/bin/bash

# Get the root directory of the project
PROJECT_ROOT="/Users/egiacalone/Downloads/TODO/Sketchbook"

# Find all .ts and .js files in the src directory
FILES=$(find "$PROJECT_ROOT/src" -type f \( -name "*.ts" -o -name "*.js" \))

# Initialize an array to store potentially unused files
POTENTIALLY_UNUSED_FILES=()

# Iterate over each file
for FILE_PATH in $FILES; do
    # Extract the base name of the file (e.g., "GameManager" from "GameManager.ts")
    FILE_BASENAME=$(basename "$FILE_PATH")
    FILE_BASENAME_NO_EXT="${FILE_BASENAME%.*}"

    # Skip if the basename is empty
    if [ -z "$FILE_BASENAME_NO_EXT" ]; then
        continue
    fi

    # Search for the basename in all other files in the src directory
    # -r: recursive
    # -w: match whole words
    # -l: print only the names of files containing matches
    # -I: process only text files (ignore binary files)
    # --exclude="$(basename "$FILE_PATH")": exclude the file itself from the search
    # --exclude-dir=node_modules: exclude node_modules directory
    MATCHES=$(grep -r -w -l -I --exclude="$(basename "$FILE_PATH")" --exclude-dir=node_modules "$FILE_BASENAME_NO_EXT" "$PROJECT_ROOT/src")

    # If no matches are found, add the file to the list of potentially unused files
    if [ -z "$MATCHES" ]; then
        POTENTIALLY_UNUSED_FILES+=("$FILE_PATH")
    fi
done

# Print the list of potentially unused files
if [ ${#POTENTIALLY_UNUSED_FILES[@]} -eq 0 ]; then
    echo "No potentially unused .ts or .js files found in src directory."
else
    echo "Potentially unused .ts or .js files in src directory:"
    for UNUSED_FILE in "${POTENTIALLY_UNUSED_FILES[@]}"; do
        echo "- $UNUSED_FILE"
    done
fi
