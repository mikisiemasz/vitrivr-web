import {Routes, Route, Navigate, NavLink} from "react-router-dom";
import Layout from "./components/Layout";
import {SearchCard} from "./components/SearchCard";
import {FaceSearch} from "./components/FaceSearch";
import VideoPage from "./components/VideoPage";
import {PeopleTab} from "./components/PeopleTab/PeopleTab";
import {SearchProvider} from "./state/SearchContext.tsx";
import "./styles/styles.css"
import "./components/PeopleTab/PeopleTab.css";

function Home() {
    return (
        <div className="sc-page">
            <SearchCard/>
            <FaceSearch/>
        </div>
    );
}

function TopNav() {
    return (
        <nav className="pt-nav">
            <NavLink to="/" end className={({isActive}) => isActive ? "active" : ""}>Search</NavLink>
            <NavLink to="/people" className={({isActive}) => isActive ? "active" : ""}>People</NavLink>
        </nav>
    );
}

export default function App() {
    const initialBlocks: never[] = [];
    return (
        <Layout>
            <SearchProvider initial={{blocks: initialBlocks}}>
                <TopNav/>
                <Routes>
                    <Route path="/" element={<Home/>}/>
                    <Route path="/people" element={<PeopleTab/>}/>
                    <Route path="/video/:id" element={<VideoPage/>}/>
                    <Route path="*" element={<Navigate to="/" replace/>}/>
                </Routes>
            </SearchProvider>
        </Layout>
    );
}
