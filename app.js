document.addEventListener("DOMContentLoaded", async () => {
    const status = document.getElementById("status");
    const canvas = document.getElementById("preview-canvas");
    const context = canvas.getContext("2d");
    let model;
    let datasetDescriptors = [];

    const SALESFORCE_INSTANCE_URL = "https://anthea2-dev-ed.develop.my.salesforce.com";
    const SALESFORCE_USERNAME = "shree@shreenijha.sandbox";
    const SALESFORCE_PASSWORD = "Stagency@123";
    const SALESFORCE_SECURITY_TOKEN = "NmdXtcC2SRTCnV0gdQrQxD5I";

    // Load BlazeFace model
    const loadModel = async () => {
        try {
            status.innerText = "Loading BlazeFace model...";
            model = await blazeface.load();
            console.log("BlazeFace model loaded successfully.");
            status.innerText = "BlazeFace model loaded.";
        } catch (error) {
            console.error("Error loading BlazeFace model:", error);
            status.innerText = "Failed to load BlazeFace model.";
        }
    };

    // Extract images from zip file
    const extractZipImages = async (file) => {
        const zip = new JSZip();
        const zipContent = await zip.loadAsync(file);
        const imageFiles = [];

        for (const [filename, fileData] of Object.entries(zipContent.files)) {
            if (/\.(png|jpg|jpeg|webp)$/i.test(filename)) {
                const imageData = await fileData.async("base64");
                imageFiles.push({ name: filename, src: `data:image/${filename.split('.').pop()};base64,${imageData}` });
            }
        }

        return imageFiles;
    };

    // Extract facial landmarks from an image
    const extractLandmarks = async (img) => {
        try {
            const predictions = await model.estimateFaces(img, false);
            if (predictions.length > 0) {
                return predictions[0].landmarks;
            } else {
                return null;
            }
        } catch (error) {
            console.error("Error extracting landmarks:", error);
            return null;
        }
    };

    // Load dataset descriptors
    const loadDatasetDescriptors = async (images) => {
        for (const { name, src } of images) {
            const img = new Image();
            img.src = src;
            await new Promise((resolve) => (img.onload = resolve));

            const landmarks = await extractLandmarks(img);
            if (landmarks) {
                datasetDescriptors.push({ name, landmarks });
                console.log(`Processed dataset image: ${name}`);
            } else {
                console.error(`No face detected in dataset image: ${name}`);
            }
        }
    };

    // Calculate Euclidean distance
    const calculateEuclideanDistance = (landmarks1, landmarks2) => {
        return Math.sqrt(
            landmarks1
                .map((point, i) => (point[0] - landmarks2[i][0]) ** 2 + (point[1] - landmarks2[i][1]) ** 2)
                .reduce((sum, diff) => sum + diff, 0)
        );
    };

    // Compare input image with dataset
    const compareInputImage = async (inputImage) => {
        const inputLandmarks = await extractLandmarks(inputImage);
        if (!inputLandmarks) {
            status.innerText = "No face detected in the input image.";
            status.className = "error";
            return "Unauthorized";
        }

        let bestMatch = { name: "unknown", distance: Infinity };
        for (const dataset of datasetDescriptors) {
            const distance = calculateEuclideanDistance(inputLandmarks, dataset.landmarks);
            if (distance < bestMatch.distance) {
                bestMatch = { name: dataset.name, distance };
            }
        }

        if (bestMatch.distance > 0.6) {
            status.innerText = "Unauthorized: No matching driver found.";
            status.className = "error";
            return "Unauthorized";
        } else {
            status.innerText = `Authorized: Match found with ${bestMatch.name}`;
            status.className = "success";
            return "Authorized";
        }
    };

    // Push verification result to Salesforce
    const pushToSalesforce = async (verificationResult, inputImageBlob) => {
        try {
            const data = {
                Status__c: verificationResult,
                Driver_Image__c: `data:image/jpeg;base64,${await blobToBase64(inputImageBlob)}`,
            };

            const response = await fetch(
                `${SALESFORCE_INSTANCE_URL}/services/data/v55.0/sobjects/Driver_Verification__c`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${SALESFORCE_SECURITY_TOKEN}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(data),
                    mode: 'cors',
                }
            );

            if (!response.ok) {
                const errorText = await response.text();
                console.error("Salesforce Record Creation Error:", errorText);

                // Adding more descriptive error handling
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const result = await response.json();
            console.log("Record created in Salesforce:", result);

            status.innerText = `Record successfully created in Salesforce with ID: ${result.id}`;
            status.className = "success";
        } catch (error) {
            // Enhanced error logging for debugging
            console.error("Error pushing data to Salesforce:", error);

            if (error.message.includes('401')) {
                console.error("Unauthorized: Check your Bearer token.");
            } else if (error.message.includes('403')) {
                console.error("Forbidden: Check your API user permissions.");
            } else if (error.message.includes('404')) {
                console.error("Not Found: Check the Salesforce endpoint URL.");
            } else {
                console.error("Unknown error occurred.");
            }

            status.innerText = "Failed to create record in Salesforce. Check console for details.";
            status.className = "error";
        }
    };

    const blobToBase64 = (blob) =>
        new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result.split(",")[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });

    // Process input image
    document.getElementById("process-btn").addEventListener("click", async () => {
        const fileInput = document.getElementById("file-upload");
        if (!fileInput.files.length) {
            status.innerText = "Please select an input image.";
            status.className = "error";
            return;
        }

        const file = fileInput.files[0];
        const img = new Image();
        img.src = URL.createObjectURL(file);

        img.onload = async () => {
            canvas.width = img.width;
            canvas.height = img.height;
            context.drawImage(img, 0, 0);

            status.innerText = "Processing...";
            try {
                const verificationResult = await compareInputImage(img);
                await pushToSalesforce(verificationResult, file);
            } catch (error) {
                console.error("Error during processing:", error);
                status.innerText = "An error occurred during processing.";
                status.className = "error";
            }
        };

        img.onerror = () => {
            console.error("Error loading input image.");
            status.innerText = "Failed to load the input image.";
            status.className = "error";
        };
    });

    // Load dataset zip
    document.getElementById("zip-upload").addEventListener("change", async (event) => {
        const zipFile = event.target.files[0];
        if (!zipFile) {
            status.innerText = "Please select a zip file containing the dataset.";
            status.className = "error";
            return;
        }

        try {
            status.innerText = "Extracting dataset...";
            const images = await extractZipImages(zipFile);
            await loadDatasetDescriptors(images);
            status.innerText = "Dataset loaded successfully.";
            status.className = "success";
        } catch (error) {
            console.error("Error loading dataset:", error);
            status.innerText = "Failed to load the dataset.";
            status.className = "error";
        }
    });

    // Initialize the model
    await loadModel();
});
