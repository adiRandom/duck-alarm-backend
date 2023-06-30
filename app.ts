import {initializeApp} from "firebase/app";
import {getFirestore, query, collection, onSnapshot, doc, setDoc, DocumentData} from "firebase/firestore";
import firebaseConfig from "./firebase.json";
import portAudio from "naudiodon"
import * as fs from "fs";
import {getAudioDurationInSeconds} from "get-audio-duration";


const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

type Alarm = {
    hour: number;
    minute: number;
    isEnable: boolean;
}

type Metadata = {
    shouldRing: boolean;
}

type State = {
    alarms: Alarm[];
    shouldRing: boolean;
}

let state: State = {
    alarms: [],
    shouldRing: false
}

const deviceId = process.argv[2] || "-1";
const ringtonePath = process.argv[3] || "../ringtone.wav";

const METADATA_DOC = "metadata";
const METADATA_COLLECTION = "metadata";
const ALARMS_COLLECTION = "alarms";

let loopInterval: NodeJS.Timeout | null = null

function getAudioOutput() {
    return new (portAudio.AudioIO as any)({
        outOptions: {
            channelCount: 2,
            sampleFormat: portAudio.SampleFormat16Bit,
            sampleRate: 48000,
            deviceId: parseInt(deviceId), // Use -1 or omit the deviceId to select the default device
            closeOnError: true // Close the stream if an audio error is detected, if set false then just log the error
        }
    } as any);
}

let audioOutput = getAudioOutput();

function getAlarms() {
    // Fetch alarms from firestores
    const q = query(collection(db, ALARMS_COLLECTION));
    onSnapshot(q, (querySnapshot) => {
        const alarmList: Alarm[] = [];
        querySnapshot.forEach((doc) => {
            alarmList.push(doc.data() as Alarm);
        });

        state.alarms = alarmList;
    });
}

function listenForRingStatus() {
    // Listen for ring status
    const q = (doc(db, METADATA_COLLECTION, METADATA_DOC))
    onSnapshot(q, (querySnapshot) => {
        const document = querySnapshot.data() as Metadata;
        if (!document.shouldRing) {
            stopRing();
        }
    });
}

function playSound() {
    const rs = fs.createReadStream(ringtonePath);
    rs.pipe(audioOutput as any);

    audioOutput.start();
}


async function playAndLoopSound() {
    const duration = await getAudioDurationInSeconds(ringtonePath)
    console.log(`Playing sound for ${duration} seconds`)
    playSound()

    if (loopInterval) {
        clearInterval(loopInterval)
    }

    // Loop the audio
    loopInterval = setInterval(() => {
        if (!state.shouldRing) {
            audioOutput = getAudioOutput();
            playSound()
        }
    }, duration * 1000)
}

async function startRing() {
    await setDoc(doc(db, METADATA_COLLECTION, METADATA_DOC), {
        shouldRing: true
    } as DocumentData)

    state.shouldRing = true;

    playAndLoopSound()
    sendNotification();
}

function stopRing() {
    state.shouldRing = false;
    try {
        // Quit seems to not work. But calling it twice triggers an error which stops the sound
        audioOutput.quit();
        audioOutput.quit();
    }catch (e){
        // Do nothing
    }
    if(loopInterval) {
        clearInterval(loopInterval)
        loopInterval = null
    }
}

function sendNotification() {
    // TODO: Impl
}


function onCron() {
    // Check alarms every minute
    setInterval(() => {
        const now = new Date();
        const nowHour = now.getHours();
        const nowMinute = now.getMinutes();

        state.alarms.forEach(alarm => {
            const isNow = alarm.hour === nowHour && alarm.minute === nowMinute;
            if (alarm.isEnable && isNow) {
                startRing()
            }
        }, 1000 * 60)
    })
}

function main() {
    playAndLoopSound()
    setTimeout(() => {
        stopRing()
        console.log("Done")
    }, 3000)

    getAlarms();
    listenForRingStatus();
    onCron();
}

main()

//TODO:
// - Stop sound
// - Send notification
