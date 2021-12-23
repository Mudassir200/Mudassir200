/**
 * Copyright (c) Microblink Ltd. All rights reserved.
 */

/**
 * This example app demonstrates how to use BlinkID In-browser SDK to achieve the following:
 *
 * - Change default SDK settings
 * - Scan front and back side of the identity document with file upload (combined experience)
 * - Provide visual feedback to the end-user during the scan
 */
import * as BlinkIDSDK from "@microblink/blinkid-in-browser-sdk";

// General UI helpers
const initialMessageEl = document.getElementById("msg") as HTMLHeadingElement;
const progressEl = document.getElementById("load-progress") as HTMLProgressElement;
const scanImageElement = document.getElementById("target-image") as HTMLImageElement;
const inputImageFileFrontSide = document.getElementById("image-file-front-side") as HTMLInputElement;
const inputImageFileBackSide = document.getElementById("image-file-back-side") as HTMLInputElement;

/**
 * Check browser support, customize settings and load WASM SDK.
 */
function main() {

    // Check if browser has proper support for WebAssembly
    if (!BlinkIDSDK.isBrowserSupported()) {
        initialMessageEl.innerText = "This browser is not supported!";
        return;
    }

    // 1. It's possible to obtain a free trial license key on microblink.com
    const licenseKey = "sRwAAAYJbG9jYWxob3N0r/lOPk4/w35CpJlWLc09Zs/mjuGYKJq7GjtRvUpB50NLGDbNQfrme34VlyR9wNs/P4L6GtUVgiQ1Rahc34/rXvsi/ca+hsgPa6udsMam5GcIQBblkWcamv/qu2cYWmM8Tm9Uk2PwHy7Jw1jBRoK5tfvZgo7AiNWUmvJoR2JgkyCSH3ZZOZcGiOdOk5O86+LDIRCoLo//ARugB9Wh/3ym5JPQvYCyzyGpkJtlA4HTnRduma2oAT7Qw/XLjVX7t5Js7MeX59oY0pKA9EQUPIKFWYLcQKeKmTVdj1QVf17DBFJgHY3N587WALhyznh5CJTNMeSTgUikTAGvT48SSDonVqFc";

    // 2. Create instance of SDK load settings with your license key
    const loadSettings = new BlinkIDSDK.WasmSDKLoadSettings(licenseKey);

    // [OPTIONAL] Change default settings

    // Show or hide hello message in browser console when WASM is successfully loaded
    loadSettings.allowHelloMessage = true;

    // In order to provide better UX, display progress bar while loading the SDK
    loadSettings.loadProgressCallback = (progress: number) => progressEl!.value = progress;

    // Set absolute location of the engine, i.e. WASM and support JS files
    loadSettings.engineLocation = window.location.href;

    // 3. Load SDK
    BlinkIDSDK.loadWasmModule(loadSettings).then((sdk: BlinkIDSDK.WasmSDK) => {
        document.getElementById("screen-initial")?.classList.add("hidden");
        document.getElementById("screen-start")?.classList.remove("hidden");
        document.getElementById("start-button")?.addEventListener("click", (ev: any) => {
            ev.preventDefault();
            startScan(sdk);
        });
    }, (error: any) => {
        initialMessageEl.innerText = "Failed to load SDK!";
        console.error("Failed to load SDK!", error);
    });
}

/**
 * Scan single side of identity document with web camera.
 */
async function startScan(sdk: BlinkIDSDK.WasmSDK) {
    document.getElementById("screen-start")?.classList.add("hidden");
    document.getElementById("screen-scanning")?.classList.remove("hidden");

    // 1. Create a recognizer objects which will be used to recognize single image or stream of images.
    //

    // GenericCombine ID Recognizer - scan ID documents on both sides
    const combinedGenericIDRecognizer = await BlinkIDSDK.createBlinkIdCombinedRecognizer(sdk);

    // [OPTIONAL] Proceed with scanning the back side even if the front side result is uncertain.
    const settings = await combinedGenericIDRecognizer.currentSettings();
    settings.allowUncertainFrontSideScan = true;
    await combinedGenericIDRecognizer.updateSettings(settings);

    // 2. Create a RecognizerRunner object which orchestrates the recognition with one or more

    //    recognizer objects.
    const recognizerRunner = await BlinkIDSDK.createRecognizerRunner(

    // SDK instance to use
    sdk, 

    // List of recognizer objects that will be associated with created RecognizerRunner object
    [combinedGenericIDRecognizer], 

    // [OPTIONAL] Should recognition pipeline stop as soon as first recognizer in chain finished recognition
    false);

    // 3. Prepare front side image for scan action - keep in mind that SDK can only process images represented

    //    in internal CapturedFrame data structure. Therefore, auxiliary method "captureFrame" is provided.

    // Make sure that image file is provided
    const fileFrontSide = getImageFromInput(inputImageFileFrontSide.files);
    if (!fileFrontSide) {
        alert("No image files provided!");

        // Release memory on WebAssembly heap used by the RecognizerRunner
        recognizerRunner?.delete();

        // Release memory on WebAssembly heap used by the recognizer
        combinedGenericIDRecognizer?.delete();
        inputImageFileFrontSide.value = "";
        return;
    }
    const imageFrame = await getImageFrame(fileFrontSide);

    // 4. Start the recognition and await for the results
    const processResultFrontSide = await recognizerRunner.processImage(imageFrame);

    // 5. If recognition of the first side was successful, process the back side
    if (processResultFrontSide !== BlinkIDSDK.RecognizerResultState.Empty) {

        // 6. Prepare back side image for scan action
        const fileBackSide = getImageFromInput(inputImageFileBackSide.files);
        if (!fileBackSide) {
            alert("No image files provided!");

            // Release memory on WebAssembly heap used by the RecognizerRunner
            recognizerRunner?.delete();

            // Release memory on WebAssembly heap used by the recognizer
            combinedGenericIDRecognizer?.delete();
            inputImageFileBackSide.value = "";
            return;
        }
        const imageFrame = await getImageFrame(fileBackSide);

        // 7. Start the recognition and await for the results
        const processResultBackSide = await recognizerRunner.processImage(imageFrame);
        if (processResultBackSide !== BlinkIDSDK.RecognizerResultState.Empty) {

            // 8. If recognition of the back side was successful, obtain the result and display it
            const results = await combinedGenericIDRecognizer.getResult();
            if (results.state !== BlinkIDSDK.RecognizerResultState.Empty) {
                console.log("BlinkIDCombined results", results);
                const firstName = results.firstName || results.mrz.secondaryID;
                const lastName = results.lastName || results.mrz.primaryID;
                const dateOfBirth = {
                    year: results.dateOfBirth.year || results.mrz.dateOfBirth.year,
                    month: results.dateOfBirth.month || results.mrz.dateOfBirth.month,
                    day: results.dateOfBirth.day || results.mrz.dateOfBirth.day
                };
                alert(`Hello, ${firstName} ${lastName}!\n You were born on ${dateOfBirth.year}-${dateOfBirth.month}-${dateOfBirth.day}.`);
            }
        }
        else {
            alert("Could not extract information from the back side of a document!");
        }
    }
    else {
        alert("Could not extract information from the front side of a document!");
    }

    // 9. Release all resources allocated on the WebAssembly heap and associated with camera stream

    // Release memory on WebAssembly heap used by the RecognizerRunner
    recognizerRunner?.delete();

    // Release memory on WebAssembly heap used by the recognizer
    combinedGenericIDRecognizer?.delete();

    // Hide scanning screen and show scan button again
    inputImageFileFrontSide.value = "";
    inputImageFileBackSide.value = "";
    scanImageElement.src = "";
    document.getElementById("screen-start")?.classList.remove("hidden");
    document.getElementById("screen-scanning")?.classList.add("hidden");
}

function getImageFromInput(fileList: FileList | null): File | null {
    if (fileList === null) {
        return null;
    }
    let image = null;
    const imageRegex = RegExp(/^image\//);
    for (let i = 0; i < fileList.length; ++i) {
        if (imageRegex.exec(fileList[i].type)) {
            image = fileList[i];
        }
    }
    return image;
}

async function getImageFrame(file: File): Promise<BlinkIDSDK.CapturedFrame> {
    scanImageElement.src = URL.createObjectURL(file);
    await scanImageElement.decode();
    return BlinkIDSDK.captureFrame(scanImageElement);
}

// Run
main();
