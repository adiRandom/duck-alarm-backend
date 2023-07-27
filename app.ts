import {initializeApp} from "firebase/app";
import {collection, doc, DocumentData, getDoc, getFirestore, onSnapshot, query, setDoc} from "firebase/firestore";
import firebaseConfig from "./firebase.json";
import playSoundLib from 'play-sound'
import {getAudioDurationInSeconds} from "get-audio-duration";
import {ChildProcess} from "child_process";
import admin, {messaging} from "firebase-admin";
import {Message} from "firebase-admin/messaging";
import serviceAccount from "./serviceAccount.json";


const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as any),

});
type Alarm = {
    hour: number;
    min: number;
    isEnable: boolean;
    repeatingDays: number[];
    isPm: boolean;
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
    return playSoundLib({})
    // return new (portAudio.AudioIO as any)({
    //     outOptions: {
    //         channelCount: 2,
    //         sampleFormat: portAudio.SampleFormat16Bit,
    //         sampleRate: 48000,
    //         deviceId: parseInt(deviceId), // Use -1 or omit the deviceId to select the default device
    //         closeOnError: true // Close the stream if an audio error is detected, if set false then just log the error
    //     }
    // } as any);
}

let audioOutput = getAudioOutput();
let currentAudioPlayer: ChildProcess | null = null;

function getAlarms() {
    // Fetch alarms from firestores
    const q = query(collection(db, ALARMS_COLLECTION));
    onSnapshot(q, (querySnapshot) => {
        const alarmList: Alarm[] = [];
        querySnapshot.forEach((doc) => {
            console.log("Alarm: ", doc.data())
            alarmList.push(doc.data() as Alarm);
        });

        console.log("Alarms: ", alarmList)
        state.alarms = alarmList;
    });
}

function listenForRingStatus() {
    // Listen for ring status
    const q = (doc(db, METADATA_COLLECTION, METADATA_DOC))
    onSnapshot(q, (querySnapshot) => {
        const document = querySnapshot.data() as Metadata;
        console.log(`Should ring: ${document.shouldRing}`)
        console.log(`Current state: ${state.shouldRing}`)
        if (document.shouldRing) {
            if (!state.shouldRing) {
                // Not ringing yet
                startRing();
            }
        } else {
            stopRing();
        }
    });
}

function playSound() {
    if (currentAudioPlayer) {
        currentAudioPlayer.kill()
    }

    currentAudioPlayer = audioOutput.play(ringtonePath)
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
        if (state.shouldRing) {
            audioOutput = getAudioOutput();
            playSound()
        }
    }, duration * 1000)
}

async function startRing() {
    console.log("Starting ring")
    state.shouldRing = true;

    await setDoc(doc(db, METADATA_COLLECTION, METADATA_DOC), {
        shouldRing: true
    } as DocumentData)
    console.log("Playing sound")

    playAndLoopSound()
    sendNotification();
}

function stopRing() {
    state.shouldRing = false;
    currentAudioPlayer?.kill()

    if (loopInterval) {
        clearInterval(loopInterval)
        loopInterval = null
    }
}

async function getFCMToken() {
    const colRef = collection(db, `metadata`)
    const docData = await getDoc(doc(colRef, `metadata`))
    return docData.data()?.fcmToken
}

async function sendNotification() {
    const message: Message = {
        apns: {
            headers: {
                "apns-priority": "5",
            },
            payload: {
                "aps": {
                    "alert": {
                        "title": "Rise and Shine",
                        "body": "Time to wake up! Get up and move!"
                    },
                    contentAvailable: true,
                    sound: "default"
                }
            }
        },
        data: {
            score: '850',
            time: '2:45'
        },
        token: await getFCMToken()
    };

// Send a message to the device corresponding to the provided
// registration token.
    messaging().send(message)
        .then((response: any) => {
            // Response is a message ID string.
            console.log('Successfully sent message:', response);
        })
        .catch((error: any) => {
            console.log('Error sending message:', error);
        });
}


function onCron() {
    // Check alarms every minute
    setInterval(() => {
        const now = new Date();
        const nowHour = now.getHours();
        const nowMinute = now.getMinutes();

        state.alarms.forEach(alarm => {
            console.log(alarm)
            console.log(`Alarm time: ${getHourIn24Format(alarm.hour, alarm.isPm)}:${alarm.min}`)
            const isNow = getHourIn24Format(alarm.hour, alarm.isPm) === nowHour && alarm.min === nowMinute;
            const isToday = alarm.repeatingDays.length === 0 || alarm.repeatingDays.includes(getDayOfWeek());
            console.log(`isNow: ${isNow}, isToday: ${isToday} time: ${nowHour}:${nowMinute}`)
            if (alarm.isEnable && isNow && isToday) {
                startRing()
            }
        })
    }, 1000 * 15)
}

function getDayOfWeek() {
    return new Date().getDay() + 6 % 7
}

function getHourIn24Format(hour: number, isPm: boolean) {
    if (hour === 12) {
        return isPm ? 12 : 0;
    }

    return isPm ? hour + 12 : hour;
}


function main() {
    getAlarms();
    listenForRingStatus();
    onCron();
}


main()
