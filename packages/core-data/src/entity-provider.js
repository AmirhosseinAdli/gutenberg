/**
 * WordPress dependencies
 */
import {
	createContext,
	useContext,
	useCallback,
	useEffect,
	useMemo,
} from '@wordpress/element';
import { useSelect, useDispatch } from '@wordpress/data';
import { parse, serialize } from '@wordpress/blocks';

/**
 * Internal dependencies
 */
import { defaultEntities, kinds } from './entities';

const entities = {
	...defaultEntities.reduce( ( acc, entity ) => {
		if ( ! acc[ entity.kind ] ) {
			acc[ entity.kind ] = {};
		}
		acc[ entity.kind ][ entity.name ] = { context: createContext() };
		return acc;
	}, {} ),
	...kinds.reduce( ( acc, kind ) => {
		acc[ kind.name ] = {};
		return acc;
	}, {} ),
};
const getEntity = ( kind, type ) => {
	if ( ! entities[ kind ] ) {
		throw new Error( `Missing entity config for kind: ${ kind }.` );
	}

	if ( ! entities[ kind ][ type ] ) {
		entities[ kind ][ type ] = { context: createContext() };
	}

	return entities[ kind ][ type ];
};

/**
 * Context provider component for providing
 * an entity for a specific entity type.
 *
 * @param {Object} props          The component's props.
 * @param {string} props.kind     The entity kind.
 * @param {string} props.type     The entity type.
 * @param {number} props.id       The entity ID.
 * @param {*}      props.children The children to wrap.
 *
 * @return {Object} The provided children, wrapped with
 *                   the entity's context provider.
 */
export default function EntityProvider( { kind, type, id, children } ) {
	const Provider = getEntity( kind, type ).context.Provider;
	return <Provider value={ id }>{ children }</Provider>;
}

/**
 * Hook that returns the ID for the nearest
 * provided entity of the specified type.
 *
 * @param {string} kind The entity kind.
 * @param {string} type The entity type.
 */
export function useEntityId( kind, type ) {
	return useContext( getEntity( kind, type ).context );
}

/**
 * Hook that returns the value and a setter for the
 * specified property of the nearest provided
 * entity of the specified type.
 *
 * @param {string} kind  The entity kind.
 * @param {string} type  The entity type.
 * @param {string} prop  The property name.
 * @param {string} [_id] An entity ID to use instead of the context-provided one.
 *
 * @return {[*, Function]} A tuple where the first item is the
 *                          property value and the second is the
 *                          setter.
 */
export function useEntityProp( kind, type, prop, _id ) {
	const providerId = useEntityId( kind, type );
	const id = _id ?? providerId;

	const { value, fullValue } = useSelect(
		( select ) => {
			const { getEntityRecord, getEditedEntityRecord } = select( 'core' );
			const entity = getEntityRecord( kind, type, id ); // Trigger resolver.
			const editedEntity = getEditedEntityRecord( kind, type, id );
			return entity && editedEntity
				? {
						value: editedEntity[ prop ],
						fullValue: entity[ prop ],
				  }
				: {};
		},
		[ kind, type, id, prop ]
	);
	const { editEntityRecord } = useDispatch( 'core' );
	const setValue = useCallback(
		( newValue ) => {
			editEntityRecord( kind, type, id, {
				[ prop ]: newValue,
			} );
		},
		[ kind, type, id, prop ]
	);

	return [ value, setValue, fullValue ];
}

/**
 * Hook that returns block content getters and setters for
 * the nearest provided entity of the specified type.
 *
 * The return value has the shape `[ blocks, onInput, onChange ]`.
 * `onInput` is for block changes that don't create undo levels
 * or dirty the post, non-persistent changes, and `onChange` is for
 * peristent changes. They map directly to the props of a
 * `BlockEditorProvider` and are intended to be used with it,
 * or similar components or hooks.
 *
 * @param {string} kind                            The entity kind.
 * @param {string} type                            The entity type.
 * @param {Object} options
 * @param {Object} [options.initialEdits]          Initial edits object for the entity record.
 * @param {string} [options.blocksProp='blocks']   The name of the entity prop that holds the blocks array.
 * @param {string} [options.contentProp='content'] The name of the entity prop that holds the serialized blocks.
 * @param {string} [options.id]                    An entity ID to use instead of the context-provided one.
 *
 * @return {[WPBlock[], Function, Function]} The block array and setters.
 */
export function useEntityBlockEditor(
	kind,
	type,
	{
		initialEdits,
		blocksProp = 'blocks',
		contentProp = 'content',
		id: _id,
	} = {}
) {
	const providerId = useEntityId( kind, type );
	const id = _id ?? providerId;

	const [ content, setContent ] = useEntityProp(
		kind,
		type,
		contentProp,
		id
	);

	const { editEntityRecord } = useDispatch( 'core' );
	useEffect( () => {
		if ( initialEdits ) {
			editEntityRecord( kind, type, id, initialEdits, {
				undoIgnore: true,
			} );
		}
	}, [ id ] );
	const initialBlocks = useMemo( () => {
		// Guard against other instances that might have
		// set content to a function already.
		if ( content && typeof content !== 'function' ) {
			const parsedContent = parse( content );
			return parsedContent.length ? parsedContent : [];
		}
		return [];
	}, [ content ] );
	const [ blocks = initialBlocks, onInput ] = useEntityProp(
		kind,
		type,
		blocksProp,
		id
	);

	const onChange = useCallback(
		( nextBlocks ) => {
			onInput( nextBlocks );
			// Use a function edit to avoid serializing often.
			setContent( ( { blocks: blocksToSerialize } ) =>
				serialize( blocksToSerialize )
			);
		},
		[ onInput, setContent ]
	);
	return [ blocks, onInput, onChange ];
}
