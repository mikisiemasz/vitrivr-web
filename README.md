# VITRIVR-WEB

## Description

The vitrivr frontend, **vitrivr-web**, was developed as a React application, as this framework enables straightforward
modularization of components and facilitates deployment.

The frontend architecture follows a modular, component-based approach, making it easily adaptable and extendable to
accommodate potential changes in the backend. Queries are formulated through different components that act as building
blocks. These components can either be used individually or combined to form temporal queries.

Each block provides a selection for the modality type (**CLIP**, **emotions**, **OCR**, **ASR**).

* **CLIP** enables users to submit either textual queries or perform image-to-image searches to retrieve the *k* nearest
  neighbors.
* In the context of **emotions**, a textual query (CLIP) can be integrated with a filter to restrict results to a
  particular emotion.
* Emotion detection is a multimodal process that integrates facial expression analysis, automatic speech emotion
  recognition, and OCR-based text emotion analysis into a unified score.
* Furthermore, the system is equipped with the capability to process both OCR and ASR through textual queries.

The frontend further provides functionality to display and filter search results for faster access. The available
filters encompass options such as media type, including videos, images, and 3D models.

The ensuing results are presented in descending order of relevance. With regard to the video results, playback is
initiated at the frame that most closely corresponds to the query.

The filtering functionality is of particular importance in the context of video retrieval competitions, as it enables
the refinement of the result set.

Moreover, the frontend incorporates the [DRES](https://github.com/dres-dev/DRES) framework, which was developed to
assess the performance of multimedia retrieval systems.

---

## Project Structure

```
vitrivr-web/
├── vitrivr-web/
│   ├── public/
│   ├── src/
│   │   ├── assets/
│   │   ├── components/
│   │   ├── dres/
│   │   ├── lib/
│   │   ├── state/
│   │   ├── styles/
│   │   ├── utils/
│   │   ├── vitrivr/
│   │   ├── App.tsx
│   │   └── main.tsx
```

---

## Setup

1. **Navigate to the frontend directory**

```bash
cd vitrivr-web 
```

2. **Create the .env file**
   In the .env file the address of the vitrivr-engine, DRES-server, etc. are saved.

   For serving files from own server run python3 -m http.server <port> in the media folder
   e.g. VITE_MEDIA_PATH_PREFIX=/pathtofolder/castle/

    Also added subpath for media, to easily change for dev or competition structure
    e.g. VITE_MEDIA_SUBPATH=media/

```bash
VITE_VITRIVR_BASE_URL=http://<ip>:<port>
VITE_MEDIA_ORIGIN=http://<ip>:<port>
VITE_THUMBNAIL_ORIGIN=http://<ip>:<port>
VITE_VITRIVR_BASE_URL=
VITE_MEDIA_SUBPATH=media/
VITE_DRES_BASE_URL=https://vbs.videobrowsing.org/
VITE_DEBUG=0
```

3. **Install all dependencies**

```bash
npm install
```

4. **Build the application**

```bash
npm run build
```

5. **Run the application in development mode**

```bash
npm run dev
```

---

## Notes for developers

This frontend was specifically developed for the VBS Prague 2026. This affects some parts of the code, mainly:

- The image-to-image search, as this search operation is not permitted at the VBS, and is therefore not fully
  implemented. The components exist, but they need to be slightly adapted.
- DRES is included with a login on the upper left. The user is not forced to log in, but it is highly recommended that
  if you want to run the frontend without DRES that you remove it entirely.
