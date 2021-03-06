import React, {useCallback, useContext, useEffect, useReducer, useState} from 'react';
import PropTypes from 'prop-types';
import { getLogger } from '../core';
import { BeerItemProps } from './BeerItemProps';
import {createItem, getItems, getPageItems, newWebSocket, removeItem, updateItem} from '../api/itemApi';
import {AuthContext} from "../auth";
import {useNetwork} from "../core/useNetwork";
import {Plugins} from "@capacitor/core";
import { usePhotoGallery } from "../core/usePhotoGallery";
const {  BackgroundTask } = Plugins;

const log = getLogger('BeerItemProvider');

type SaveItemFn = (item: BeerItemProps) => Promise<any>;
type DeleteItemFn = (item: BeerItemProps) => Promise<any>;
type GetItemsFn = (token: string, id: number) => Promise<any>;

export interface ItemsState {
    items?: BeerItemProps[],
    fetching: boolean,
    fetchingError?: Error | null,
    saving: boolean,
    deleting:boolean,
    savingError?: Error | null,
    deletingError?:Error|null,
    saveItem?: SaveItemFn,
    deleteItem?:DeleteItemFn,
    getItemsOnPage?: GetItemsFn,
}

interface ActionProps {
    type: string,
    payload?: any,
}

const initialState: ItemsState = {
    fetching: false,
    saving: false,
    deleting:false
};

const FETCH_ITEMS_STARTED = 'FETCH_ITEMS_STARTED';
const FETCH_ITEMS_SUCCEEDED = 'FETCH_ITEMS_SUCCEEDED';
const FETCH_ITEMS_ON_PAGE_STARTED = 'FETCH_ITEMS_ON_PAGE_STARTED';
const FETCH_ITEMS_ON_PAGE_SUCCEEDED = 'FETCH_ITEMS_ON_PAGE_SUCCEEDED';
const FETCH_ITEMS_FAILED = 'FETCH_ITEMS_FAILED';
const SAVE_ITEM_STARTED = 'SAVE_ITEM_STARTED';
const SAVE_ITEM_SUCCEEDED = 'SAVE_ITEM_SUCCEEDED';
const SAVE_ITEM_FAILED = 'SAVE_ITEM_FAILED';
const DELETE_ITEM_SUCCEEDED ='DELETE_ITEM_SUCCEEDED';
const DELETE_ITEM_FAILED = 'DELETE_ITEM_FAILED';
const DELETE_ITEM_STARTED = 'DELETE_ITEM_STARTED';

const reducer: (state: ItemsState, action: ActionProps) => ItemsState =
    (state, { type, payload }) => {
        let items, index, item: BeerItemProps;
        switch (type) {
            case FETCH_ITEMS_STARTED:
                return { ...state, fetching: true, fetchingError: null };
            case FETCH_ITEMS_SUCCEEDED:
                /*payload.items.map( (b: BeerItemProps) => {
                    if (b._id != null) {
                        localStorage.setItem(b._id, JSON.stringify(b));
                    }
                })*/

                return { ...state, items: payload.items, fetching: false };
            case FETCH_ITEMS_ON_PAGE_STARTED:
                return { ...state, fetching: true, fetchingError: null };
            case FETCH_ITEMS_ON_PAGE_SUCCEEDED:
                return {
                    ...state,
                    items: [
                        ...(state.items || []),
                        ...payload.items,

                    ] ,
                    fetching: false
                };
            case FETCH_ITEMS_FAILED:
                return { ...state, fetchingError: payload.error, fetching: false };
            case SAVE_ITEM_STARTED:
                return { ...state, savingError: null, saving: true };
            case SAVE_ITEM_SUCCEEDED:
                /*localStorage.setItem(payload.item._id, JSON.stringify(payload.item));*/
                items = [...(state.items || [])];
                item = payload.item;
                index = items.findIndex(it => it._id === item._id);
                if (index === -1) {
                    items.splice(0, 0, item);
                } else {
                    items[index] = item;
                }
                return { ...state, items, saving: false };
            case SAVE_ITEM_FAILED:
                return { ...state, savingError: payload.error, saving: false };
            case DELETE_ITEM_STARTED:
                return { ...state, deletingError: null, deleting:true };
            case DELETE_ITEM_SUCCEEDED:
                items = [...(state.items || [])];
                item = payload.item;
                index = items.findIndex(it => it._id === item._id);
                if (index !== -1) {
                    items.splice(index, 1);
                }
                if (item._id != null) {
                    localStorage.removeItem(item._id);
                }
                return { ...state, items, deleting: false };
            case DELETE_ITEM_FAILED:
                return { ...state, deletingError: payload.error, deleting: false };
            default:
                return state;
        }
    };

export const BeerItemContext = React.createContext<ItemsState>(initialState);

interface ItemProviderProps {
    children: PropTypes.ReactNodeLike,
}

export const BeerItemProvider: React.FC<ItemProviderProps> = ({ children }) => {
    const { token } = useContext(AuthContext);
    const [state, dispatch] = useReducer(reducer, initialState);
    const { items, fetching, fetchingError, saving, savingError, deleting, deletingError } = state;
    useEffect(getItemsEffect, [token]);
    useEffect(wsEffect, [token]);
    const saveItem = useCallback<SaveItemFn>(saveItemCallback, [token]);
    const deleteItem = useCallback<DeleteItemFn>(deleteItemCallback,[token]);
    const getItemsOnPage = useCallback<GetItemsFn>(getItemsOnPageCallback, []);

    const value = { items, fetching, fetchingError, saving, savingError, saveItem, deleting, deletingError, deleteItem, getItemsOnPage};
    const { networkStatus } = useNetwork();

    const {writePictureFromServer} = usePhotoGallery();

    useEffect(() => {
        console.log("background task")
        let taskId = BackgroundTask.beforeExit(async () => {
            if (networkStatus.connected) {
                const token = localStorage.getItem("token");
                if (token !== null) {
                    for (var key in localStorage) {
                        if (key.toString().startsWith('save_')) {
                            const item = JSON.parse(localStorage.getItem(key) as string);
                            const savedItem = await (item._id ? updateItem(token, item) : createItem(token, item));
                            localStorage.removeItem(key)
                        }

                        if (key.toString().startsWith('delete_')) {
                            const item = JSON.parse(localStorage.getItem(key) as string);
                            await (removeItem(token, item))
                            localStorage.removeItem(key)
                        }
                    }
                }
            }
            BackgroundTask.finish({ taskId });
        });
    }, [networkStatus.connected])
    log('returns');
    return (
        <BeerItemContext.Provider value={value}>
            {children}
        </BeerItemContext.Provider>
    );

    function getItemsEffect() {
        let canceled = false;
        fetchItems();
        return () => {
            canceled = true;
        }

        async function fetchItems() {
            if (!token?.trim()) {
                return;
            }
            try {
                log('fetchItems started');
                dispatch({ type: FETCH_ITEMS_STARTED});
                const items = await getItems(token);
                items.map((i)=>{
                    if(i.photo){
                        writePictureFromServer(i.photo)
                    }
                    return i;
                })
                log('fetchItems succeeded');
                if (!canceled) {
                    dispatch({ type: FETCH_ITEMS_SUCCEEDED, payload: { items: items } });
                }
            } catch (error) {
                log('fetchItems failed');
                dispatch({ type: FETCH_ITEMS_FAILED, payload: { error } });
            }
        }
    }

    async function getItemsOnPageCallback(token: string, pageId: number) {
        let canceled = false;
        fetchItems();
        return () => {
            canceled = true;
        }

        async function fetchItems() {
            console.log('fetch items page provider' + token)
            try {
                log('fetchItems started');
                dispatch({ type: FETCH_ITEMS_ON_PAGE_STARTED });
                const items = await getPageItems(token, pageId);
                log('fetchItems succeeded');
                if (!canceled) {
                    dispatch({ type: FETCH_ITEMS_ON_PAGE_SUCCEEDED, payload: { items } });
                }
            } catch (error) {
                log('fetchItems failed');
                dispatch({ type: FETCH_ITEMS_FAILED, payload: { error } });
            }
        }
    }

    async function saveItemCallback(item: BeerItemProps) {
        //if ( networkStatus.connected) {
            try {
                log('saveItem started');
                dispatch({type: SAVE_ITEM_STARTED});
                const savedItem = await (item._id ? updateItem(token, item) : createItem(token, item));
                log('saveItem succeeded');
                dispatch({type: SAVE_ITEM_SUCCEEDED, payload: {item: savedItem}});
            } catch (error) {
                log('saveItem failed');
                dispatch({type: SAVE_ITEM_FAILED, payload: {error}});
            }
        /*}else{
            try {
                log('saveItem in local storage started');
                dispatch({type: SAVE_ITEM_STARTED});
                const savedItem = item._id ? localStorage.setItem("save_"+item._id, JSON.stringify(item)): localStorage.setItem("save_"+localStorage.length, JSON.stringify(item));
                log('saveItem in local storage succeeded');
                dispatch({type: SAVE_ITEM_SUCCEEDED, payload: {item: item}});
            } catch (error) {
                log('saveItem in local storage failed');
                dispatch({type: SAVE_ITEM_FAILED, payload: {error}});
            }
            alert("Saved to local storage because you are OFFLINE!")
        }*/
    }

    async function deleteItemCallback(item: BeerItemProps) {
        //if(networkStatus.connected){
            try {
                log('deleteItem started');
                dispatch({ type: DELETE_ITEM_STARTED });
                await (removeItem(token, item));
                log('deleteItem succeeded');
                dispatch({ type: DELETE_ITEM_SUCCEEDED, payload: { item: item } });
            } catch (error) {
                log('deleteItem failed');
                dispatch({ type: DELETE_ITEM_FAILED, payload: { error } });
            }
        /*}else{
            try {
                log('deleteItem local storage started');
                dispatch({ type: DELETE_ITEM_STARTED });
                localStorage.setItem("delete_"+item._id, JSON.stringify(item))
                log('deleteItem local storage succeeded');
                dispatch({ type: DELETE_ITEM_SUCCEEDED, payload: { item: item } });
            } catch (error) {
                log('deleteItem local storage failed');
                dispatch({ type: DELETE_ITEM_FAILED, payload: { error } });
            }
            alert("Deleted only on local storage because you are OFFLINE!")
        }*/

    }

    function wsEffect() {
        let canceled = false;
        log('wsEffect - connecting');
        let closeWebSocket: () => void;
        if (token?.trim()) {
            closeWebSocket = newWebSocket(token, message => {
                if (canceled) {
                    return;
                }
                const { type, payload: item } = message;
                log(`ws message, item ${type}`);
                if (type === 'created' || type === 'updated') {
                    if(item.photo){
                        writePictureFromServer(item.photo);
                    }
                    dispatch({ type: SAVE_ITEM_SUCCEEDED, payload: { item } });
                }
            });
        }
        return () => {
            log('wsEffect - disconnecting');
            canceled = true;
            closeWebSocket?.();
        }
    }
};
