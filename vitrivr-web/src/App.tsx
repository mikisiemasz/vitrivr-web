import {Routes, Route, Navigate} from "react-router-dom";
import Layout from "./components/Layout";
import {SearchCard} from "./components/SearchCard";
import {FaceSearch} from "./components/FaceSearch";
import VideoPage from "./components/VideoPage";
import {SearchProvider} from "./state/SearchContext.tsx";
import "./styles/styles.css"

function Home() {
    return (
        <div className="sc-page">
            <SearchCard/>
            <FaceSearch/>
        </div>
    );
}

export default function App() {
    const initialBlocks: never[] = [];
    return (
        <Layout>
            <SearchProvider initial={{blocks: initialBlocks}}>
                <Routes>
                    <Route path="/" element={<Home/>}/>
                    <Route path="/video/:id" element={<VideoPage/>}/>
                    <Route path="*" element={<Navigate to="/" replace/>}/>
                </Routes>
            </SearchProvider>
        </Layout>
    );
}