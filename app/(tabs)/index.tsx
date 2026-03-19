import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { useEffect, useRef, useState } from 'react';
import { Button, Image, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import ViewShot from 'react-native-view-shot';

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const [photo, setPhoto] = useState(null);
  const [pins, setPins] = useState([]);
  const [selectedPin, setSelectedPin] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [savedPhotos, setSavedPhotos] = useState([]);
  const [showGallery, setShowGallery] = useState(false);
  const [showTitleModal, setShowTitleModal] = useState(false);
  const [titleText, setTitleText] = useState('');
  const cameraRef = useRef(null);
  const viewShotRef = useRef(null);

  useEffect(() => {
    loadSavedPhotos();
  }, []);

  async function loadSavedPhotos() {
    try {
      const data = await AsyncStorage.getItem('savedPhotos');
      if (data) setSavedPhotos(JSON.parse(data));
    } catch (e) {
      console.log('Error loading photos', e);
    }
  }

  async function saveCurrentPhoto() {
    setShowTitleModal(true);
  }

  async function confirmSave(title) {
    try {
      const newEntry = { id: Date.now(), uri: photo, pins, title: title || 'Untitled' };
      const updated = [newEntry, ...savedPhotos];
      const jsonString = JSON.stringify(updated);
      await AsyncStorage.setItem('savedPhotos', jsonString);
      setSavedPhotos(JSON.parse(jsonString));
      setShowTitleModal(false);
      setTitleText('');
      alert('Photo saved!');
    } catch (e) {
      alert('Error: ' + e.message);
    }
  }

  async function deletePhoto(id) {
    const updated = savedPhotos.filter(p => p.id !== id);
    await AsyncStorage.setItem('savedPhotos', JSON.stringify(updated));
    setSavedPhotos(updated);
  }

  async function takePhoto() {
    if (cameraRef.current) {
      const result = await cameraRef.current.takePictureAsync();
      setPhoto(result.uri);
      setPins([]);
    }
  }

  async function pickFromGallery() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });
    if (!result.canceled) {
      setPhoto(result.assets[0].uri);
      setPins([]);
    }
  }

  async function sharePhoto() {
    try {
      const uri = await viewShotRef.current.capture();
      await Sharing.shareAsync(uri);
    } catch (e) {
      alert('Error sharing: ' + e.message);
    }
  }

  function handleImageTap(event) {
    const { locationX, locationY } = event.nativeEvent;
    const newPin = { id: Date.now(), x: locationX, y: locationY, note: '' };
    setPins(prev => [...prev, newPin]);
    setSelectedPin(newPin);
    setNoteText('');
  }

  function handlePinTap(event, pin) {
    event.stopPropagation();
    setSelectedPin(pin);
    setNoteText(pin.note);
  }

  function saveNote() {
    setPins(prev => prev.map(p => p.id === selectedPin.id ? { ...p, note: noteText } : p));
    setSelectedPin(null);
  }

  function deletePin() {
    setPins(prev => prev.filter(p => p.id !== selectedPin.id));
    setSelectedPin(null);
  }

  function openSavedPhoto(entry) {
    setPhoto(entry.uri);
    setPins(entry.pins);
    setShowGallery(false);
  }

  if (!permission) return <View />;

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>We need your permission to use the camera</Text>
        <Button onPress={requestPermission} title="Grant Permission" />
      </View>
    );
  }

  if (showGallery) {
    return (
      <View style={styles.container}>
        <View style={styles.galleryHeader}>
          <TouchableOpacity onPress={() => setShowGallery(false)}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.galleryTitle}>Saved Photos</Text>
        </View>
        <ScrollView>
          {savedPhotos.length === 0 && (
            <Text style={styles.emptyText}>No saved photos yet!</Text>
          )}
           {savedPhotos.map(entry => (
            <View key={entry.id} style={styles.galleryItem}>
              <TouchableOpacity onPress={() => openSavedPhoto(entry)} style={styles.thumbnailContainer}>
                <Image source={{ uri: entry.uri }} style={styles.thumbnail} />
                <Text style={styles.galleryItemTitle}>{entry.title || 'Untitled'}</Text>
                <Text style={styles.pinCount}>{entry.pins.length} pin(s)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deletePhotoButton} onPress={() => deletePhoto(entry.id)}>
                <Text style={styles.deletePhotoText}>🗑 Delete</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  if (photo) {
    return (
      <View style={styles.container}>
        <ViewShot ref={viewShotRef} style={styles.imageContainer}>
          <TouchableOpacity activeOpacity={1} onPress={handleImageTap} style={styles.imageContainer}>
            <Image source={{ uri: photo }} style={styles.camera} />
            {pins.map(pin => (
              <TouchableOpacity
                key={pin.id}
                style={[styles.pin, { left: pin.x - 15, top: pin.y - 15 }]}
                onPress={(e) => handlePinTap(e, pin)}
              >
                <Text style={styles.pinEmoji}>📍</Text>
                {pin.note ? (
                  <View style={styles.notePreview}>
                    <Text style={styles.notePreviewText} numberOfLines={1}>{pin.note}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </ViewShot>

        <View style={styles.bottomBar}>
          <TouchableOpacity style={styles.bottomButton} onPress={() => setPhoto(null)}>
            <Text style={styles.bottomButtonText}>Retake</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.bottomButton, styles.savePhotoButton]} onPress={saveCurrentPhoto}>
            <Text style={styles.bottomButtonText}>Save Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.bottomButton} onPress={sharePhoto}>
            <Text style={styles.bottomButtonText}>Share</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.bottomButton} onPress={() => setShowGallery(true)}>
            <Text style={styles.bottomButtonText}>Gallery</Text>
          </TouchableOpacity>
        </View>

        <Modal visible={selectedPin !== null} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.modalBox}>
              <Text style={styles.modalTitle}>Pin Note</Text>
              <TextInput
                style={styles.textInput}
                placeholder="Add a note..."
                value={noteText}
                onChangeText={setNoteText}
                multiline
                autoFocus
              />
              <TouchableOpacity style={styles.saveButton} onPress={saveNote}>
                <Text style={styles.saveText}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteButton} onPress={deletePin}>
                <Text style={styles.deleteText}>Delete Pin</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <Modal visible={showTitleModal} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.modalBox}>
              <Text style={styles.modalTitle}>Name this photo</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. Living room inspection"
                value={titleText}
                onChangeText={setTitleText}
                autoFocus
              />
              <TouchableOpacity style={styles.saveButton} onPress={() => confirmSave(titleText)}>
                <Text style={styles.saveText}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteButton} onPress={() => setShowTitleModal(false)}>
                <Text style={styles.deleteText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView style={styles.camera} facing="back" ref={cameraRef} />
      <TouchableOpacity style={styles.captureButton} onPress={takePhoto}>
        <View style={styles.captureInner} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.galleryButton} onPress={() => setShowGallery(true)}>
        <Text style={styles.galleryButtonText}>Gallery</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.pickButton} onPress={pickFromGallery}>
        <Text style={styles.galleryButtonText}>📷 Roll</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  message: { textAlign: 'center', paddingBottom: 10, color: '#fff' },
  camera: { flex: 1 },
  imageContainer: { flex: 1 },
  pin: { position: 'absolute', alignItems: 'center' },
  pinEmoji: { fontSize: 28 },
  notePreview: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
    maxWidth: 100,
  },
  notePreviewText: { color: '#fff', fontSize: 10 },
  captureButton: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureInner: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#fff' },
  galleryButton: {
    position: 'absolute',
    bottom: 50,
    right: 30,
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 10,
    borderRadius: 8,
  },
  galleryButtonText: { color: '#fff', fontSize: 14 },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 16,
    backgroundColor: '#111',
  },
  bottomButton: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    padding: 12,
    borderRadius: 8,
    minWidth: 90,
    alignItems: 'center',
  },
  savePhotoButton: { backgroundColor: '#007AFF' },
  bottomButtonText: { color: '#fff', fontSize: 14 },
  galleryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingTop: 50,
    backgroundColor: '#111',
  },
  backText: { color: '#007AFF', fontSize: 16, marginRight: 16 },
  galleryTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  emptyText: { color: '#aaa', textAlign: 'center', marginTop: 40, fontSize: 16 },
  thumbnail: { width: '100%', height: 200, marginBottom: 4 },
  pinCount: { color: '#aaa', fontSize: 12, padding: 8 },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingBottom: 300,
  },
  modalBox: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
  },
  modalTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  textInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    fontSize: 16,
    minHeight: 80,
    marginBottom: 12,
  },
  saveButton: {
    backgroundColor: '#007AFF',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 8,
  },
  saveText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  deleteButton: { padding: 14, borderRadius: 10, alignItems: 'center' },
  deleteText: { color: 'red', fontSize: 16 },

    galleryItem: { marginBottom: 16 },
  thumbnailContainer: { width: '100%' },
  deletePhotoButton: {
    backgroundColor: '#ff3b30',
    padding: 10,
    alignItems: 'center',
  },
  deletePhotoText: { color: '#fff', fontSize: 14 },

  pickButton: {
    position: 'absolute',
    bottom: 50,
    left: 30,
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 10,
    borderRadius: 8,
  },

  galleryItemTitle: { color: '#fff', fontSize: 16, fontWeight: 'bold', padding: 8 },
});