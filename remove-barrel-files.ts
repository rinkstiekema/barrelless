import * as fs from "fs";
import * as path from "path";

// Read the barrel files configuration
const readBarrelFilesConfig = (): Record<string, boolean> => {
    try {
        const jsonData = fs.readFileSync(
            path.resolve(process.cwd(), "barrel-files.json"),
            "utf8"
        );
        return JSON.parse(jsonData);
    } catch (error) {
        console.error("Error reading barrel-files.json:", error);
        process.exit(1);
    }
};

// Function to delete files
const deleteFile = (filePath: string): boolean => {
    // Check if the file exists before attempting to delete
    if (!fs.existsSync(filePath)) {
        console.warn(`File does not exist: ${filePath}`);
        return false;
    }

    try {
        fs.unlinkSync(filePath);
        console.log(`Deleted: ${filePath}`);
        return true;
    } catch (error) {
        console.error(`Error deleting ${filePath}:`, error);
        return false;
    }
};

// Main function to process barrel files
const removeBarrelFiles = (): void => {
    const barrelFiles = readBarrelFilesConfig();
    let deletedCount = 0;
    let totalCount = 0;
    let missingCount = 0;

    console.log("Starting barrel file removal process...");

    // Loop through all files in the configuration
    for (const [filePath, shouldDelete] of Object.entries(barrelFiles)) {
        totalCount++;

        // Only delete files marked as true
        if (shouldDelete) {
            if (deleteFile(filePath)) {
                deletedCount++;
            } else {
                missingCount++;
            }
        }
    }

    console.log(`\nRemoval complete!`);
    console.log(`Processed ${totalCount} files`);
    console.log(`Deleted ${deletedCount} barrel files`);
    console.log(`Missing files: ${missingCount}`);
};

// Execute the script
removeBarrelFiles();
