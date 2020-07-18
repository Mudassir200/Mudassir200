import * as BlinkIDSDK from "@microblink/blinkid-in-browser-sdk";

// Check if browser has proper support for WebAssembly
if ( !BlinkIDSDK.isBrowserSupported() )
{
    document.getElementById( "loading" )!.innerText = "This browser is not supported!";
}
else
{
    startApp();
}

function startApp()
{
    const licenseKey = "sRwAAAYJbG9jYWxob3N0r/lOPig/w35CpJnWL20/ZAAoebb3NufX/n3ggfadJPgD0vjJf/MgR8kIFKEUN8WrHbL8cDwQxnC9RlWP/bMe10nVKg53+/Y34o49MZwzxn5yigxGhS+SgnHFbEfwVeqU2hSpRSiEIyh07SiifoursyJjVlTbqhuiIoHx4ypndxofEwAwVNyEgHC+BrFYgGPDX5GP6UnLH1S7UJeB+r79P7qtmrLehctAtuY03XcZaHduoh+43FOV0456WctoFcXiLmm3EwLQkXFh";
    const loadSettings = new BlinkIDSDK.WasmSDKLoadSettings( licenseKey );

    // Change default settings - more information about these settings can be found in the documentation
    loadSettings.allowHelloMessage = true;
    loadSettings.loadProgressCallback = null;
    loadSettings.engineLocation = "/resources";
    loadSettings.workerLocation = "/resources";

    // Load SDK
    BlinkIDSDK.loadWasmModule( loadSettings ).then
    (
        sdk =>
        {
            document.getElementById( "loading" )!.classList.add( "hidden" );
            const app = new MyApp( sdk );
            ( window as any ).app = app;
        },
        error =>
        {
            console.error( "Failed to load SDK!", error );
        }
    );

    class MyApp
    {
        private sdk: BlinkIDSDK.WasmSDK;
        private cameraFeed: HTMLVideoElement;
        private cameraFeedback: HTMLCanvasElement;
        private feedbackDrawContext: CanvasRenderingContext2D;

        private videoRecognizer: BlinkIDSDK.VideoRecognizer | null = null;
        private recognizerRunner: BlinkIDSDK.RecognizerRunner | null = null;

        private genericIDRecognizer: BlinkIDSDK.BlinkIdRecognizer | null = null;
        private combinedGenericIDRecognizer: BlinkIDSDK.BlinkIdCombinedRecognizer | null = null;
        private idBarcodeRecognizer: BlinkIDSDK.IdBarcodeRecognizer | null = null;

        private scanFromCameraBtn: HTMLButtonElement;
        private scanFromFileInput: HTMLInputElement;
        private scanAgainBtn: HTMLButtonElement;

        private viewLanding: HTMLDivElement;
        private viewScanFromCamera: HTMLDivElement;
        private viewScanFromFile: HTMLDivElement;
        private viewResults: HTMLDivElement;

        private scanImageElement: HTMLImageElement;
        private resultsTextArea: HTMLTextAreaElement;

        // For combined purpose only
        private continuousRecognition = false;
        private scanBothSidesFlag: HTMLInputElement;
        private labelScanFromImage: HTMLLabelElement;

        constructor( sdk: BlinkIDSDK.WasmSDK )
        {
            this.sdk = sdk;

            // Register helper elements
            this.cameraFeed = document.getElementById( "camera-feed" ) as HTMLVideoElement;
            this.cameraFeedback = document.getElementById( "camera-feedback" ) as HTMLCanvasElement;
            this.feedbackDrawContext = this.cameraFeedback.getContext( "2d" ) as CanvasRenderingContext2D;

            this.scanFromCameraBtn = document.getElementById( "scan-from-camera" ) as HTMLButtonElement;
            this.scanFromFileInput = document.getElementById( "scan-from-file" ) as HTMLInputElement;
            this.scanAgainBtn = document.getElementById( "scan-again" ) as HTMLButtonElement;

            this.viewLanding = document.getElementById( "view-landing" ) as HTMLDivElement;
            this.viewScanFromCamera = document.getElementById( "view-scan-from-camera" ) as HTMLDivElement;
            this.viewScanFromFile = document.getElementById( "view-scan-from-file" ) as HTMLDivElement;
            this.viewResults = document.getElementById( "view-results" ) as HTMLDivElement;

            this.scanImageElement = document.getElementById( "scan-image" ) as HTMLImageElement;
            this.resultsTextArea = document.getElementById( "results-text-area" ) as HTMLTextAreaElement;

            this.scanBothSidesFlag = document.getElementById( "scan-both-sides" ) as HTMLInputElement;

            this.labelScanFromImage = document.getElementById( "showcase-scan-from-image-label" ) as HTMLLabelElement;

            // Register UI actions
            this.scanFromCameraBtn
                    .addEventListener( "click", ev =>
                    {
                        ev.preventDefault();
                        this.scanFromCamera();
                    } );

            this.scanFromFileInput
                    .addEventListener( "change", (ev: any) => 
                    { 
                        this.scanFiles( ev.target.files ) 
                    } );

            this.scanAgainBtn
                    .addEventListener( "click", ev =>
                    {
                        ev.preventDefault();
                        this.resetUI();
                    } );

            this.scanBothSidesFlag
                    .addEventListener( "change", () =>
                    {
                        this.continuousRecognition = this.scanBothSidesFlag.checked;
                        if (this.continuousRecognition)
                        {
                            this.scanFromFileInput.setAttribute( "disabled", "true" );
                            this.labelScanFromImage.innerHTML = "Image upload is not supported if both sides scanning is enabled";
                        }
                        else
                        {
                            this.scanFromFileInput.removeAttribute( "disabled" );
                            this.labelScanFromImage.innerHTML = "Scan from file";
                        }
                    } );

            // Display UI
            this.viewLanding.classList.remove( "hidden" );
        }

        // Processing with camera
        async scanFromCamera()
        {
            this.viewLanding.classList.add( "hidden" );
            this.viewScanFromCamera.classList.remove( "hidden" );

            // Function which should be called when recognition process is done or terminated.
            const clearRecognizersAndRunner = () =>
            {
                this.videoRecognizer?.releaseVideoFeed();
                this.recognizerRunner?.delete();
                this.genericIDRecognizer?.delete();
                this.combinedGenericIDRecognizer?.delete();
                this.idBarcodeRecognizer?.delete();
            }

            // 1. Create a recognizer objects which will be used to recognize single image or stream of images.
            //
            // Generic ID Recognizer - scan various ID documents
            // GenericCombine ID Recognizer - scan ID documents on both sides
            // ID Barcode Recognizer - scan barcodes from various ID documents
            this.genericIDRecognizer = await BlinkIDSDK.createBlinkIdRecognizer( this.sdk );
            this.combinedGenericIDRecognizer = await BlinkIDSDK.createBlinkIdCombinedRecognizer( this.sdk );
            this.idBarcodeRecognizer = await BlinkIDSDK.createIdBarcodeRecognizer( this.sdk );

            // Optional: extend recognizer settings to get images in result.
            // Different recognizers have different settings.
            let settingsUpdated = false;
            const settings = await this.genericIDRecognizer.currentSettings();
            const properties = [
                "returnFullDocumentImage",
                "returnFaceImage",
                "returnSignatureImage",
                "allowSignature"
            ];

            for ( const property of properties )
            {
                if ( property in settings )
                {
                    ( settings as any )[ property ] = true;
                    settingsUpdated = true;
                }
            }
            if ( settingsUpdated )
            {
                await this.genericIDRecognizer.updateSettings( settings );
            }

            // Optional: create a callbacks object that will receive recognition events, such as detected object location etc.
            const callbacks = {
                onQuadDetection: ( quad: BlinkIDSDK.DisplayableQuad ) => this.drawQuad( quad ),
                onFirstSideResult: () => {
                    if ( this.continuousRecognition )
                    {
                        alert( "First side recognition done! Turn the document over!" );
                    }
                }
            }

            // 2. Create a RecognizerRunner object which orchestrates the recognition with one or more
            //    recognizer objects.
            if ( this.continuousRecognition )
            {
                this.recognizerRunner = await BlinkIDSDK.createRecognizerRunner
                (
                    // SDK instance to use
                    this.sdk,
                    // list of recognizer objects that will be associated with created RecognizerRunner object
                    [ this.combinedGenericIDRecognizer ],
                    // (optional) should recognition pipeline stop as soon as first recognizer in chain finished recognition
                    false,
                    // (optional) callbacks object that will receive recognition events
                    callbacks
                );
            }
            else
            {
                this.recognizerRunner = await BlinkIDSDK.createRecognizerRunner
                (
                    // SDK instance to use
                    this.sdk,
                    // list of recognizer objects that will be associated with created RecognizerRunner object
                    [ this.genericIDRecognizer, this.idBarcodeRecognizer ],
                    // (optional) should recognition pipeline stop as soon as first recognizer in chain finished recognition
                    false,
                    // (optional) callbacks object that will receive recognition events
                    callbacks
                );
            }

            // 4. Create a VideoRecognizer object and attach it to HTMLVideoElement that will be used for displaying the camera feed
            try
            {
                this.videoRecognizer = await BlinkIDSDK.VideoRecognizer.createVideoRecognizerFromCameraStream
                (
                    this.cameraFeed,
                    this.recognizerRunner
                );

                let finalResults: any = [];
                if ( this.continuousRecognition )
                {
                    // use more complex startRecognition
                    this.videoRecognizer.startRecognition
                    (
                        async ( recognitionState: BlinkIDSDK.RecognizerResultState ) =>
                        {
                            if ( !this.videoRecognizer )
                            {
                                return;
                            }
                            // pause recognition before performing any async operation
                            this.videoRecognizer.pauseRecognition();

                            if ( recognitionState !== BlinkIDSDK.RecognizerResultState.Empty )
                            {
                                const result = await this.combinedGenericIDRecognizer?.getResult();
                                // skip empty results
                                if ( result?.state !== BlinkIDSDK.RecognizerResultState.Empty )
                                {
                                    // obtain recognition results
                                    const results = await this.saveTemporaryResults( result );
                                    finalResults.push( results );

                                    if ( window.confirm( "Continue processing?" ) )
                                    {
                                        this.videoRecognizer.resumeRecognition( true );
                                    }
                                    else
                                    {
                                        this.showResults( finalResults );
                                        
                                        clearRecognizersAndRunner();
                                    }
                                }
                            }
                        }
                    );
                }
                else
                {
                    // use simple promise-based API for one-shot recognition
                    // 5. Start the recognition and await for the results
                    const processResult = await this.videoRecognizer.recognize();

                    // 6. If recognition was successful, obtain the result and display it
                    if ( processResult !== BlinkIDSDK.RecognizerResultState.Empty )
                    {
                        const genericIDResults = await this.genericIDRecognizer.getResult();
                        if ( genericIDResults.state !== BlinkIDSDK.RecognizerResultState.Empty )
                        {
                            this.showResults( genericIDResults );
                        }

                        const idBarcodeResult = await this.idBarcodeRecognizer.getResult();
                        if ( idBarcodeResult.state !== BlinkIDSDK.RecognizerResultState.Empty )
                        {
                            this.showResults( idBarcodeResult );
                        }
                    }
                    else
                    {
                        this.showResults( "Could not extract information!" );
                    }

                    // 7. Release all resources allocated on the WebAssembly heap and associated with camera stream
                    clearRecognizersAndRunner();
                }
            }
            catch ( error )
            {
                console.error( "Error during initialization of VideoRecognizer:", error );

                return;
            }
        }

        async saveTemporaryResults( results: any ): Promise< string >
        {
            return new Promise((resolve, _reject) => resolve( results ) );
        }

        /**
         * Scan images and extract information - this is more compact example than the previous one which uses
         * web camera.
         */
        async scanFiles( fileList: FileList )
        {
            this.viewLanding.classList.add( "hidden" );
            this.viewScanFromFile.classList.remove( "hidden" );

            // Function which should be called when recognition process is done or terminated.
            const clearRecognizersAndRunner = () =>
            {
                this.recognizerRunner?.delete();
                this.genericIDRecognizer?.delete();
                this.idBarcodeRecognizer?.delete();
            }

            // 1. Create a recognizer objects which will be used to recognize single image or stream of images.
            //
            // Generic ID Recognizer - scan various ID documents
            // ID Barcode Recognizer - scan barcodes from various ID documents
            this.genericIDRecognizer = await BlinkIDSDK.createBlinkIdRecognizer( this.sdk );
            this.idBarcodeRecognizer = await BlinkIDSDK.createIdBarcodeRecognizer( this.sdk );

            // Optional: extend recognizer settings to get images in result.
            // Different recognizers have different settings.
            let settingsUpdated = false;
            const settings = await this.genericIDRecognizer.currentSettings();
            const properties = [
                "returnFullDocumentImage",
                "returnFaceImage",
                "returnSignatureImage",
                "allowSignature"
            ];
            for ( const property of properties )
            {
                if ( property in settings )
                {
                    ( settings as any )[ property ] = true;
                    settingsUpdated = true;
                }
            }
            if ( settingsUpdated )
            {
                await this.genericIDRecognizer.updateSettings( settings );
            }

            // 2. Create a RecognizerRunner object which orchestrates the recognition with one or more
            //    recognizer objects.
            this.recognizerRunner = await BlinkIDSDK.createRecognizerRunner
            (
                // SDK instance to use
                this.sdk,
                // list of recognizer objects that will be associated with created RecognizerRunner object
                [ this.genericIDRecognizer, this.idBarcodeRecognizer ],
                // (optional) should recognition pipeline stop as soon as first recognizer in chain finished recognition
                false
            );

            // 3. Prepare image for scan action - keep in mind that SDK can only process images represented in
            //    internal CapturedFrame data structure. Therefore, auxiliary method "captureFrame" is provided.

            // Make sure that image file is provided
            let file = null;
            const imageRegex = RegExp( /^image\// );
            for ( let i = 0; i < fileList.length; ++i )
            {
                if ( imageRegex.exec( fileList[ i ].type ) )
                {
                    file = fileList[ i ];
                }
            }
            if ( !file )
            {
                this.showResults( "No image files provided!" );
                clearRecognizersAndRunner();
                return;
            }

            this.scanImageElement!.src = URL.createObjectURL( file );
            await this.scanImageElement.decode();
            const imageFrame = BlinkIDSDK.captureFrame( this.scanImageElement );

            // 4. Process images
            const processResult = await this.recognizerRunner.processImage( imageFrame );

            if ( processResult === BlinkIDSDK.RecognizerResultState.Empty )
            {
                this.showResults( "Could not process image!" );
                clearRecognizersAndRunner();
                return;
            }

            // 5. Get results
            const genericIDResults = await this.genericIDRecognizer.getResult();
            if ( genericIDResults.state !== BlinkIDSDK.RecognizerResultState.Empty )
            {
                this.showResults( genericIDResults );
            }

            const genericCombinedIDResults = await this.genericIDRecognizer.getResult();
            if ( genericCombinedIDResults.state !== BlinkIDSDK.RecognizerResultState.Empty )
            {
                this.showResults( genericCombinedIDResults );
            }

            const idBarcodeResult = await this.idBarcodeRecognizer.getResult();
            if ( idBarcodeResult.state !== BlinkIDSDK.RecognizerResultState.Empty )
            {
                this.showResults( idBarcodeResult );
            }

            // 6. Release all resources allocated on the WebAssembly heap
            clearRecognizersAndRunner();
        }

        resetUI()
        {
            this.viewLanding.classList.remove( "hidden" );
            this.viewScanFromCamera.classList.add( "hidden" );
            this.viewScanFromFile.classList.add( "hidden" );
            this.viewResults.classList.add( "hidden" );
            this.scanFromFileInput.value = "";
        }

        showResults( results: any )
        {
            this.viewLanding.classList.add( "hidden" );
            this.viewScanFromCamera.classList.add( "hidden" );
            this.viewScanFromFile.classList.add( "hidden" );

            this.viewResults.classList.remove( "hidden" );

            // Image fields contain ImageData objects which are quite heavy for display in text format.
            const safeResults = this.removeImagesFromResults( results );
            this.resultsTextArea.value = JSON.stringify( safeResults, null, 2 );
        }

        removeImagesFromResults( results: any )
        {
            const safeResults = {};

            for ( const key in results )
            {
                if ( key.toLowerCase().includes( "image" ) )
                {
                    console.log( "removeImagesFromResults:", key );
                    continue;
                }
                ( safeResults as any )[ key ] = results[ key ];
            }

            return safeResults;
        }

        /* Auxiliary methods for scan feedback during camera scanning */
        drawQuad( quad: BlinkIDSDK.DisplayableQuad )
        {
            this.clearDrawCanvas();
            this.setupColor( quad );

            const ctx = this.feedbackDrawContext;
            this.applyTransform( ctx, quad.transformMatrix );
            ctx.beginPath();
            ctx.moveTo( quad.topLeft.x, quad.topLeft.y );
            ctx.lineTo( quad.topRight.x, quad.topRight.y );
            ctx.lineTo( quad.bottomRight.x, quad.bottomRight.y );
            ctx.lineTo( quad.bottomLeft.x, quad.bottomLeft.y );
            ctx.closePath();
            ctx.stroke();
        }

        applyTransform( ctx: CanvasRenderingContext2D, transformMatrix: Float32Array )
        {
            const canvasAR = this.cameraFeedback.width / this.cameraFeedback.height;
            const videoAR = this.cameraFeed.videoWidth / this.cameraFeed.videoHeight;

            let xOffset = 0;
            let yOffset = 0;
            let scaledVideoHeight = 0
            let scaledVideoWidth = 0

            if ( canvasAR > videoAR )
            {
                // pillarboxing: https://en.wikipedia.org/wiki/Pillarbox
                scaledVideoHeight = this.cameraFeedback.height;
                scaledVideoWidth = videoAR * scaledVideoHeight;
                xOffset = ( this.cameraFeedback.width - scaledVideoWidth ) / 2.0;
            }
            else
            {
                // letterboxing: https://en.wikipedia.org/wiki/Letterboxing_(filming)
                scaledVideoWidth = this.cameraFeedback.width;
                scaledVideoHeight = scaledVideoWidth / videoAR;
                yOffset = ( this.cameraFeedback.height - scaledVideoHeight ) / 2.0;
            }

            // first transform canvas for offset of video preview within the HTML video element (i.e. correct letterboxing or pillarboxing)
            ctx.translate( xOffset, yOffset );
            // second, scale the canvas to fit the scaled video
            ctx.scale
            (
                scaledVideoWidth / this.cameraFeed.videoWidth,
                scaledVideoHeight / this.cameraFeed.videoHeight
            );

            // finally, apply transformation from image coordinate system to
            // https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/setTransform
            ctx.transform
            (
                transformMatrix[0],
                transformMatrix[3],
                transformMatrix[1],
                transformMatrix[4],
                transformMatrix[2],
                transformMatrix[5]
            );
        }

        clearDrawCanvas()
        {
            this.cameraFeedback.width = this.cameraFeedback.clientWidth;
            this.cameraFeedback.height = this.cameraFeedback.clientHeight;

            this.feedbackDrawContext.clearRect
            (
                0,
                0,
                this.cameraFeedback.width,
                this.cameraFeedback.height
            );
        }

        setupColor( displayable: BlinkIDSDK.Displayable )
        {
            const ctx = this.feedbackDrawContext;

            let color = "#FFFF00FF";

            if ( displayable.detectionStatus === 0 )
            {
                color = "#FF0000FF";
            }
            else if ( displayable.detectionStatus === 1 )
            {
                color = "#00FF00FF";
            }

            ctx.fillStyle = color;
            ctx.strokeStyle = color;
            ctx.lineWidth = 5;
        }
    }   
}